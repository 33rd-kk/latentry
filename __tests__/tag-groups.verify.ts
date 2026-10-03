/**
 * The WD14 tag grouping behind the tag extractor (lib/tag-groups.ts).
 *
 * Run with: npm test -- tag-groups
 */
import { classifyTag, tagForPrompt, WD14_CATEGORY_CHARACTER } from "../lib/tag-groups"

let passed = 0
let failed = 0

function expectGroup(tag: string, group: string, category = 0) {
  const actual = classifyTag(tag, category)
  if (actual === group) {
    passed++
  } else {
    failed++
    console.error(`FAIL: ${tag} -> ${actual}, expected ${group}`)
  }
}

expectGroup("hatsune_miku", "character", WD14_CATEGORY_CHARACTER)
for (const tag of ["1girl", "3girls", "solo", "multiple_girls", "solo_focus"]) expectGroup(tag, "subject")
for (const tag of ["long_hair", "brown_hair", "parted_bangs", "twintails", "ahoge", "hair_ornament", "side_ponytail", "hair_bun"]) expectGroup(tag, "hair")
for (const tag of ["blue_eyes", "brown_eyes", "heterochromia", "slit_pupils"]) expectGroup(tag, "eyes")
for (const tag of ["pubic_hair", "female_pubic_hair", "bikini_tan", "tanlines", "large_breasts", "dark_skin", "colored_skin", "mole_under_mouth", "animal_ears", "cat_tail", "horns", "pointy_ears", "freckles"]) expectGroup(tag, "body")
for (const tag of ["school_uniform", "white_shirt", "pleated_skirt", "black_thighhighs", "choker", "glasses", "nude", "completely_nude", "detached_sleeves", "hair_ribbon"]) {
  // hair_ribbon mentions hair; it is kept with hair on purpose (worn in the hair).
  expectGroup(tag, tag === "hair_ribbon" ? "hair" : "outfit")
}
for (const tag of ["smile", "blush", "open_mouth", "closed_eyes", "one_eye_closed", ":o", ":d", "^_^", "tears"]) expectGroup(tag, "expression")
for (const tag of ["standing", "sitting", "arms_up", "looking_at_viewer", "from_side", "hand_on_own_hip", "crossed_legs", "upper_body", "breast_press", "holding_cup", "v"]) expectGroup(tag, "pose")
for (const tag of ["onsen", "steam", "water", "outdoors", "simple_background", "blurry"]) expectGroup(tag, "scene")

const promptCases: [string, string][] = [["long_hair", "long hair"], ["^_^", "^_^"], [">_<", ">_<"], [":o", ":o"], ["hatsune_miku", "hatsune miku"]]
for (const [input, want] of promptCases) {
  if (tagForPrompt(input) === want) passed++
  else {
    failed++
    console.error(`FAIL: tagForPrompt(${input}) -> ${tagForPrompt(input)}, expected ${want}`)
  }
}

console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
