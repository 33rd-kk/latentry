// Sorts WD14 tags into the groups the tag extractor offers: what
// makes a character recognisable (hair, eyes, body, outfit) apart from what
// only describes this one picture (expression, pose, scene).
//
// WD14 only marks named characters (category 4) and ratings (9); everything
// else arrives as "general", so the split below is by keyword. It is a
// heuristic — a miss lands in "scene", where the user can still pick it.

/** WD14 category for a named character, from the tagger's selected_tags.csv. */
export const WD14_CATEGORY_CHARACTER = 4

export type TagGroup =
  | 'character'
  | 'subject'
  | 'hair'
  | 'eyes'
  | 'body'
  | 'outfit'
  | 'expression'
  | 'pose'
  | 'scene'

/** Display order, and the order picked tags are added to a prompt. */
export const TAG_GROUPS: TagGroup[] = ['character', 'subject', 'hair', 'eyes', 'body', 'outfit', 'expression', 'pose', 'scene']

/** The groups that carry a character from one picture into another — selected by default. */
export const CHARACTER_GROUPS: ReadonlySet<TagGroup> = new Set(['character', 'subject', 'hair', 'eyes', 'body', 'outfit'])

/**
 * What a pose reference contributes: its pose and framing only. The picture's
 * own hair or outfit would pull the new character towards the reference's.
 */
export const POSE_GROUPS: ReadonlySet<TagGroup> = new Set(['pose'])

const SUBJECT = /^(\d+\+?(girl|boy|other)s?|solo|solo_focus|male_focus|multiple_(girls|boys|others))$/

// Checked before hair/eyes/outfit, since "closed_eyes" or "hand_in_own_hair"
// mention a body part but describe the moment, not the character.
const EXPRESSION =
  /^(smile|light_smile|grin|smirk|blush|light_blush|full-face_blush|open_mouth|closed_mouth|parted_lips|tongue|tongue_out|teeth|fang_out|tears|crying|crying_with_eyes_open|streaming_tears|sad|angry|annoyed|frown|frowning|pout|pouting|surprised|scared|embarrassed|nervous|expressionless|serious|smug|happy|laughing|sleepy|closed_eyes|half-closed_eyes|one_eye_closed|wink|winking|wide-eyed|rolling_eyes|ahegao|drooling|saliva|sweat|sweatdrop|nose_blush|heart-shaped_pupils|empty_eyes|naughty_face|seductive_smile|evil_smile|v-shaped_eyebrows|raised_eyebrows|furrowed_brow|:[a-z0-9<>3]|;[a-z0-9]|[\^>x]_[\^<x]|\^\^)/

const POSE =
  /^(standing|sitting|kneeling|lying|squatting|crouching|walking|running|jumping|leaning(_\w+)?|bending(_\w+)?|on_(back|stomach|side|one_knee|all_fours|bed|floor|couch|chair)|all_fours|seiza|wariza|indian_style|crossed_(arms|legs|ankles)|arms_(up|behind_(back|head)|at_sides|crossed)|arm_(up|behind_(back|head)|support)|hands_(up|on_(own_)?\w+|together|in_\w+|between_legs|behind_(back|head))|hand_(on|in|up|between|to)_\w+|own_hands_together|legs_(up|apart|together|crossed)|leg_up|spread_(legs|arms)|knees_(up|together)|head_tilt|outstretched_(arm|arms|hand)|reaching(_\w+)?|stretching|v|peace_sign|double_v|w|pointing(_\w+)?|waving|salute|holding(_\w+)?|looking_(at|away|back|up|down|to|over|ahead|afar|outside|at_viewer)\w*|facing_\w+|from_(above|below|behind|side|front)|profile|back|upper_body|cowboy_shot|full_body|portrait|close-up|feet_out_of_frame|head_out_of_frame|dutch_angle|pov|contrapposto|\w+_pose|hug|hugging_\w+|carrying(_\w+)?|straddling|girl_on_top|sandwiched|symmetrical_docking|breast_press|bathing|sleeping|eating|drinking|reading|dancing|fighting_stance|selfie)$/

const EYES = /(_eyes$|^eyes$|pupils|eyelashes|heterochromia|^eyeshadow$|tsurime|tareme|jitome|sanpaku)/

const BODY_FIRST = /^(pubic_hair|female_pubic_hair|male_pubic_hair|armpit_hair|body_hair|chest_hair|leg_hair|\w+_tan|tan|tanlines)$/

const HAIR =
  /(hair|bangs|ahoge|twintails|twin_braids|ponytail|braid|sidelocks?|hime_cut|bob_cut|bun$|_buns$|drill|ringlets|forelock|cowlick|antenna_hair|hairband|hairclip|kanzashi)/

const BODY =
  /^(flat_chest|small_breasts|medium_breasts|large_breasts|huge_breasts|gigantic_breasts|breasts|\w+_skin|tan|tanlines|pale_skin|muscular(_female)?|abs|toned|petite|plump|curvy|wide_hips|thick_thighs|mole(_\w+)?|freckles|fangs?|skin_fang|pointy_ears|\w+_ears|animal_ears|ears|\w*tail|horns?|\w+_horns?|wings|\w+_wings|halo|scar(_\w+)?|tattoo|\w+_tattoo|elf|demon_girl|cat_girl|fox_girl|dog_girl|wolf_girl|bunny_girl|android|vampire|loli|mature_female|child|aged_up|aged_down)$/

const OUTFIT =
  /(shirt|dress|skirt|jacket|coat|uniform|serafuku|blazer|swimsuit|bikini|leotard|kimono|yukata|hakama|apron|hoodie|sweater|cardigan|vest|pants|shorts|jeans|thighhighs|pantyhose|legwear|socks|kneehighs|boots|shoes|sandals|heels|gloves|sleeves|sleeveless|collar|choker|necklace|earrings|jewelry|bracelet|ribbon|bow|hat$|_hat|cap$|beret|hood|glasses|eyewear|headband|headwear|headgear|crown|tiara|scarf|cape|cloak|armor|belt|bra$|_bra|panties|underwear|lingerie|bodysuit|necktie|^tie$|bowtie|ascot|corset|garter|frill|lace|bandages?|mask|maid|nun|nurse|school|gym|sportswear|track|pajamas|robe|veil|wristband|scrunchie|nude|naked|topless|bottomless|barefoot|^bare_\w+|clothes|clothing|outfit|costume|ornament|pin$|brooch|badge|cross$|bag$|backpack|umbrella|weapon|sword|staff)/

/** The group a WD14 tag belongs to; `category` is WD14's own (4 = named character). */
export function classifyTag(name: string, category = 0): TagGroup {
  const tag = name.trim().toLowerCase().replace(/ /g, '_')
  if (category === WD14_CATEGORY_CHARACTER) return 'character'
  if (SUBJECT.test(tag)) return 'subject'
  if (EXPRESSION.test(tag)) return 'expression'
  if (POSE.test(tag)) return 'pose'
  if (EYES.test(tag)) return 'eyes'
  // Before HAIR, which would otherwise claim "pubic_hair", and before OUTFIT,
  // which would claim "bikini_tan" -- both are about the body, not a hairstyle
  // or something worn.
  if (BODY_FIRST.test(tag)) return 'body'
  if (HAIR.test(tag)) return 'hair'
  if (BODY.test(tag)) return 'body'
  if (OUTFIT.test(tag)) return 'outfit'
  return 'scene'
}

/**
 * A WD14 tag as it should appear in a prompt: underscores to spaces, the way
 * this app writes prompts — except for emoticon tags like ^_^ or >_<, where
 * the underscore is part of the face.
 */
export function tagForPrompt(name: string): string {
  return /[a-z0-9]{2}/i.test(name) ? name.replace(/_/g, ' ') : name
}
