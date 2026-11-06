import type { Turn } from './types.ts'

// Deliberately broad. Wrongly removing someone loses a lead. Missing a request
// means calling someone who told us to stop, which is the worse mistake.
const OPT_OUT_PHRASES = [
  /\bstop (calling|contacting|texting|ringing)\b/,
  /\bquit calling\b/,
  /\b(don'?t|do not|never) (ever )?(call|contact|ring)\b/,
  /\bno more calls\b/,
  /\bremove (me|my number|us)\b/,
  /\btake (me|us|my number) off\b/,
  /\blose my number\b/,
  /\bopt(ing)? out\b/,
  /\bunsubscribe\b/,
  /\bleave me alone\b/,
  /\bdo not call list\b/,
  /\bdon'?t want (any )?(more |these |your )?calls\b/,
]

// Only the lead's own words count, so the agent saying "I'll take you off our
// list" can't trigger it.
export function detectOptOut(turns: Turn[]): boolean {
  return turns
    .filter((turn) => turn.role === 'lead')
    .some((turn) => {
      const text = turn.text.toLowerCase().replaceAll('’', "'")
      return OPT_OUT_PHRASES.some((phrase) => phrase.test(text))
    })
}
