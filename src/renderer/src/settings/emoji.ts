/**
 * Shortcodes for `emojiAutocomplete`. GitHub/Typora names; the popup matches on the
 * prefix the user typed after the colon.
 */
const EMOJI: Record<string, string> = {
  grinning: '\u{1F600}',
  smiley: '\u{1F603}',
  smile: '\u{1F604}',
  grin: '\u{1F601}',
  laughing: '\u{1F606}',
  sweat_smile: '\u{1F605}',
  joy: '\u{1F602}',
  rofl: '\u{1F923}',
  slightly_smiling_face: '\u{1F642}',
  upside_down_face: '\u{1F643}',
  wink: '\u{1F609}',
  blush: '\u{1F60A}',
  innocent: '\u{1F607}',
  heart_eyes: '\u{1F60D}',
  star_struck: '\u{1F929}',
  kissing_heart: '\u{1F618}',
  kissing: '\u{1F617}',
  yum: '\u{1F60B}',
  stuck_out_tongue: '\u{1F61B}',
  zany_face: '\u{1F92A}',
  thinking: '\u{1F914}',
  raised_eyebrow: '\u{1F928}',
  neutral_face: '\u{1F610}',
  expressionless: '\u{1F611}',
  no_mouth: '\u{1F636}',
  smirk: '\u{1F60F}',
  unamused: '\u{1F612}',
  roll_eyes: '\u{1F644}',
  grimacing: '\u{1F62C}',
  lying_face: '\u{1F925}',
  relieved: '\u{1F60C}',
  pensive: '\u{1F614}',
  sleepy: '\u{1F62A}',
  sleeping: '\u{1F634}',
  mask: '\u{1F637}',
  face_with_thermometer: '\u{1F912}',
  nauseated_face: '\u{1F922}',
  sneezing_face: '\u{1F927}',
  hot_face: '\u{1F975}',
  cold_face: '\u{1F976}',
  dizzy_face: '\u{1F635}',
  exploding_head: '\u{1F92F}',
  cowboy_hat_face: '\u{1F920}',
  sunglasses: '\u{1F60E}',
  nerd_face: '\u{1F913}',
  monocle: '\u{1F9D0}',
  confused: '\u{1F615}',
  worried: '\u{1F61F}',
  slightly_frowning_face: '\u{1F641}',
  frowning_face: '\u{2639}\u{FE0F}',
  open_mouth: '\u{1F62E}',
  hushed: '\u{1F62F}',
  astonished: '\u{1F632}',
  flushed: '\u{1F633}',
  pleading_face: '\u{1F97A}',
  fearful: '\u{1F628}',
  cold_sweat: '\u{1F630}',
  disappointed: '\u{1F61E}',
  cry: '\u{1F622}',
  sob: '\u{1F62D}',
  scream: '\u{1F631}',
  confounded: '\u{1F616}',
  persevere: '\u{1F623}',
  sweat: '\u{1F613}',
  weary: '\u{1F629}',
  tired_face: '\u{1F62B}',
  thumbsup: '\u{1F44D}',
  thumbsdown: '\u{1F44E}',
  ok_hand: '\u{1F44C}',
  clap: '\u{1F44F}',
  raised_hands: '\u{1F64C}',
  pray: '\u{1F64F}',
  muscle: '\u{1F4AA}',
  wave: '\u{1F44B}',
  point_up: '\u{1F446}',
  point_down: '\u{1F447}',
  point_left: '\u{1F448}',
  point_right: '\u{1F449}',
  v: '\u{270C}\u{FE0F}',
  crossed_fingers: '\u{1F91E}',
  metal: '\u{1F918}',
  heart: '\u{2764}\u{FE0F}',
  broken_heart: '\u{1F494}',
  sparkling_heart: '\u{1F496}',
  fire: '\u{1F525}',
  star: '\u{2B50}',
  sparkles: '\u{2728}',
  tada: '\u{1F389}',
  rocket: '\u{1F680}',
  eyes: '\u{1F440}',
  check: '\u{2705}',
  x: '\u{274C}',
  warning: '\u{26A0}\u{FE0F}',
  question: '\u{2753}',
  exclamation: '\u{2757}',
  bulb: '\u{1F4A1}',
  memo: '\u{1F4DD}',
  book: '\u{1F4D6}',
  alarm_clock: '\u{23F0}',
  calendar: '\u{1F4C5}',
  coffee: '\u{2615}',
  beer: '\u{1F37A}',
  pizza: '\u{1F355}',
  cake: '\u{1F370}',
  apple: '\u{1F34E}',
  sunny: '\u{2600}\u{FE0F}',
  moon: '\u{1F319}',
  cloud: '\u{2601}\u{FE0F}',
  umbrella: '\u{2614}',
  snowflake: '\u{2744}\u{FE0F}',
  zap: '\u{26A1}',
  bug: '\u{1F41B}',
  cat: '\u{1F431}',
  dog: '\u{1F436}',
  panda_face: '\u{1F43C}',
  penguin: '\u{1F427}',
  whale: '\u{1F433}',
  sunflower: '\u{1F33B}',
  rose: '\u{1F339}',
  four_leaf_clover: '\u{1F340}'
}

export interface EmojiCandidate {
  /** Shortcode without the surrounding colons. */
  shortcode: string
  emoji: string
}

/** Candidates for the text typed after `:`, exact shortcode first, then prefixes. */
export function emojiCandidates(prefix: string, limit = 8): EmojiCandidate[] {
  const query = prefix.toLowerCase().replace(/^:/, '')
  if (query === '') return []
  const exact: EmojiCandidate[] = []
  const partial: EmojiCandidate[] = []
  for (const [shortcode, emoji] of Object.entries(EMOJI)) {
    if (shortcode === query) exact.push({ shortcode, emoji })
    else if (shortcode.startsWith(query)) partial.push({ shortcode, emoji })
  }
  return exact.concat(partial).slice(0, limit)
}

/** Number of shortcodes the autocomplete can complete; asserted by the harness. */
export const EMOJI_COUNT = Object.keys(EMOJI).length
