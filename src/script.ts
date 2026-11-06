import type { Agent, Lead } from './types.ts'

export function defaultFirstLine(callerName: string, businessName: string): string {
  return `Hi, this is ${callerName}, an AI assistant calling from ${businessName}. This call may be recorded.`
}

// The word "AI" has to be spoken, in capitals so "said" or "email" can't match.
export function hasDisclosure(line: string): boolean {
  return /\bA\.?I\b/.test(line) || /artificial intelligence/i.test(line)
}

// How every agent behaves, whatever its script says. The information funnel
// lives here: most important question first, one at a time, short lines.
const HOUSE_RULES = `
How to run this call:
- Ask the most important question first, then work down the list in order.
- Ask one question per turn, then stop and listen.
- Keep every line under two short sentences. This is a phone call, not an email.
- If they interrupt you, stop right away, respond to what they said, then pick up where you left off.
- If they give an answer you didn't ask for yet, accept it and skip that question later.
- If they say it's a bad time, ask when would be better, thank them, and end the call.
- Never say you're a human. If they ask, say you're an AI assistant.
- Don't guess at anything you don't know. Offer to have someone follow up instead.

If they ask you to stop calling, to take them off a list, or say they don't want these calls:
say "Understood, I'll take you off our list. Sorry to bother you." Then end the call right away.
`.trim()

function fill(text: string, lead: Pick<Lead, 'name'>): string {
  const firstName = lead.name.trim().split(/\s+/)[0]
  return text.replaceAll('{{name}}', lead.name).replaceAll('{{first_name}}', firstName)
}

export function buildFirstLine(agent: Pick<Agent, 'firstLine'>, lead: Pick<Lead, 'name'>): string {
  return fill(agent.firstLine, lead)
}

export function buildPrompt(agent: Agent, lead: Pick<Lead, 'name'>): string {
  const sections = [
    `You are ${agent.callerName}, an AI assistant calling on behalf of ${agent.businessName}.`,
    `You're speaking with ${lead.name}. You have already opened with: "${buildFirstLine(agent, lead)}"`,
    `Goal of this call: ${agent.goal}`,
    `Script:\n${fill(agent.script, lead)}`,
  ]
  if (agent.captureFields.length > 0) {
    sections.push(`By the end of the call, try to learn: ${agent.captureFields.join(', ')}.`)
  }
  sections.push(HOUSE_RULES)
  return sections.join('\n\n')
}
