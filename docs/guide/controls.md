# Controls

A control picture tells the backend the shape to draw: the edges, the depth
or the line art of a reference picture. Latentry makes it on this computer;
the reference itself is never sent, only the control picture made from it.
It goes beside a [pose](pose.md), not in place of it.

## Make a control picture

Show **Control** in the form's **Show** row (it is listed when the backend
follows control pictures), then:

1. Pick the kind: **Edges** (Canny), **Depth** or **Line art**.
2. Drop a reference picture on the slot, click it to choose a file, pick one
   **From gallery**, or take the source image with **From source**.
3. The control picture appears, white on black, as the run will send it.
   Picking another kind makes it again from the same reference.
4. **Control strength** (0.5 by default, 0–2) sets how closely the backend
   follows it.

| Kind | What it keeps | Needs |
|---|---|---|
| **Edges** | outlines and detail, from a Canny edge finder | nothing to download |
| **Depth** | what is near and far (nearer is lighter) | Depth Anything V2 Small, from Setup |
| **Line art** | the drawing's lines | Informative Drawings, from Setup |

The models are downloaded on [Setup](engine.md#control-picture-models) only
when you press **Download**. Without one, picking its kind says so. Line art
is made for photos and drawings; on anime pictures **Edges** often does
better.

## What is kept

- The reference and the control picture live only in this page's memory;
  nothing is written. Leaving the page or reloading drops them.
- A picture drawn with a control picture records its kind and strength
  (`control` in its settings), never the control picture.
- **Upscale**, **Extend** and **Faces** redraw a source on their own terms
  and do not send a control picture.
- Hidden from **Show**, the control picture is kept but not sent.

## Which backends follow them

A backend lists the kinds it follows; the slot offers only those. The
built-in engine follows all three with SDXL-family models (not Anima),
through xinsir's union ControlNet, downloaded (2.5 GB) on the first run with
a control picture; with a pose too, each keeps its own strength. ComfyUI
follows the kinds you give a ControlNet for in Settings
([Control pictures](../reference/backends.md#control-pictures)). See
[What each backend can do](../reference/backends.md#what-each-backend-can-do).
For a server of your own, see `control_kinds` in
[the backend API](https://github.com/33rd-kk/latentry/blob/main/docs/backend-api.md).

## Reference picture (IP-Adapter)

A control picture fixes the shape; a **reference** passes on the look: the
colours, the style, a character's appearance. Show **Reference** in the
**Show** row (listed when the backend takes one), drop a picture on the slot,
pick one **From gallery**, or take the source image with **From source**.
**Reference strength** (0.3 by default, 0–1) sets how much of its look the
run takes. On anime models such as Illustrious, much above 0.4 can break the
picture into streaks; start low.

- Unlike a control picture, the reference itself goes to the backend (on
  the built-in engine, that stays on this computer). In this page it lives
  in memory only, and secret mode blurs it until you click it.
- A picture drawn with one records its strength (`ip_adapter` in its
  settings), never the reference.
- It goes with a pose and a control picture; **Upscale**, **Extend** and
  **Faces** do not send it.
- The built-in engine takes it with SDXL-family models (not Anima), through
  h94's IP-Adapter Plus for SDXL with its ViT-H image encoder (Apache-2.0),
  downloaded (about 3.4 GB) on the first run with a reference. A run without
  one takes the adapter out again, so it draws exactly as before.

