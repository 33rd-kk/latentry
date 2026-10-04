"""SDXL prompts longer than CLIP's 77 tokens, without losing the tail.

Stock diffusers truncates at 77 tokens, and a Danbooru-style prompt (forty
tags is ordinary) passes that easily: whatever came last simply had no
effect. This encodes the prompt in 75-token windows, each wrapped in its own
start/end tokens, and joins the hidden states along the sequence, the way the
A1111 web UI does. The pooled embedding comes from the first window.

Positive and negative are padded to the same number of windows, since
classifier-free guidance concatenates them.
"""

from __future__ import annotations

import torch

WINDOW = 75


def _windows(tokenizer, text: str) -> list[list[int]]:
    ids = tokenizer(text, add_special_tokens=False, truncation=False).input_ids
    return [ids[i : i + WINDOW] for i in range(0, len(ids), WINDOW)] or [[]]


def _pad(tokenizer, chunk: list[int]) -> list[int]:
    pad = tokenizer.pad_token_id if tokenizer.pad_token_id is not None else tokenizer.eos_token_id
    ids = [tokenizer.bos_token_id, *chunk, tokenizer.eos_token_id]
    return ids + [pad] * (WINDOW + 2 - len(ids))


def _encode(encoder, tokenizer, windows: list[list[int]], device, want_pooled: bool):
    hidden, pooled = [], None
    for index, chunk in enumerate(windows):
        ids = torch.tensor([_pad(tokenizer, chunk)], device=device)
        out = encoder(ids, output_hidden_states=True)
        # SDXL conditions on the penultimate layer of both encoders.
        hidden.append(out.hidden_states[-2])
        if want_pooled and index == 0:
            pooled = out[0]
    return torch.cat(hidden, dim=1), pooled


@torch.no_grad()
def encode_sdxl(pipe, prompt: str, negative: str, device) -> dict:
    """Embeddings for StableDiffusionXL*Pipeline's prompt_embeds arguments."""
    tokenizers = [pipe.tokenizer, pipe.tokenizer_2]
    encoders = [pipe.text_encoder, pipe.text_encoder_2]

    positive = [_windows(tokenizer, prompt) for tokenizer in tokenizers]
    negative_windows = [_windows(tokenizer, negative) for tokenizer in tokenizers]
    count = max(len(windows) for windows in positive + negative_windows)

    def padded(windows: list[list[int]]) -> list[list[int]]:
        return windows + [[]] * (count - len(windows))

    def encode(all_windows):
        parts, pooled = [], None
        for encoder, tokenizer, windows in zip(encoders, tokenizers, all_windows):
            second = encoder is pipe.text_encoder_2
            hidden, maybe_pooled = _encode(encoder, tokenizer, padded(windows), device, want_pooled=second)
            parts.append(hidden)
            if second:
                pooled = maybe_pooled
        return torch.cat(parts, dim=-1), pooled

    prompt_embeds, pooled = encode(positive)
    if not negative.strip() and getattr(pipe.config, "force_zeros_for_empty_prompt", False):
        # What the pipeline itself does for an empty negative.
        negative_embeds, negative_pooled = torch.zeros_like(prompt_embeds), torch.zeros_like(pooled)
    else:
        negative_embeds, negative_pooled = encode(negative_windows)

    dtype = pipe.unet.dtype
    return {
        "prompt_embeds": prompt_embeds.to(dtype),
        "negative_prompt_embeds": negative_embeds.to(dtype),
        "pooled_prompt_embeds": pooled.to(dtype),
        "negative_pooled_prompt_embeds": negative_pooled.to(dtype),
    }
