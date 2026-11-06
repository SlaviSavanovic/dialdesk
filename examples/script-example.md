# Writing a script: the information funnel

A phone call isn't a form. People hang up, get distracted, or give you thirty seconds. So ask for the thing you need most first, and let everything after it be a bonus.

1. **Most important question first.** If they hang up after one answer, that answer should be the one you wanted.
2. **One question per turn.** Ask, then stop. Two questions at once and they answer neither.
3. **Short lines.** If it wouldn't sound normal said aloud, rewrite it.
4. **Exits, not traps.** A "no" ends the funnel early. Thank them and get off the phone.

dialdesk adds the rest to every agent's instructions, so a script doesn't need it: handling interruptions, never claiming to be human, and what to do when someone says stop. It also speaks the opening line with the AI disclosure, so scripts start at the first real question.

Use `{{name}}` and `{{first_name}}` anywhere to fill in the lead's name.

## Example: following up on a form fill

```
You're following up with someone who filled out a form asking for a roof quote.

Ask these in order, one at a time. Stop as soon as an answer makes the rest pointless.

1. Are you still looking to get your roof looked at?
   If no: thank them and end the call.
2. Is anything leaking right now?
   If yes: tell them we'll treat this as urgent.
3. Is this a repair, or are you thinking about a full replacement?
4. What day works best for someone to come out?

Then confirm the day, thank them, and end the call.
```

Capture fields: `still_interested`, `leak_now`, `job_type`, `best_day`

## Example: appointment reminder

```
You're reminding {{first_name}} about an appointment tomorrow at 2 PM.

1. Can you still make it tomorrow at 2?
   If yes: thank them and end the call.
2. What day this week would work better?
3. Morning or afternoon?

Tell them someone from the office will confirm the new time, then end the call.
```

Capture fields: `keeping_appointment`, `new_day`, `morning_or_afternoon`
