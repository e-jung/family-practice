# Product

<!-- impeccable:product-schema 1 -->

<!-- Written by impeccable init from the maintainer's brief and AGENTS.md; no
live interview was possible (run as a delegated agent). Facts marked
"(brief)" came from that written brief; the rest is repository evidence. -->

## Platform

web

Installable PWA (Cloudflare Worker build) plus a single-family Node build for a home LAN. Mobile web, not native.

## Users

- **Parents** (brief) setting up a family space: create the space, save the Family Code, set a Parent PIN, add kids by first name, paste this week's spelling list and a Bible verse. Usually on a phone or laptop, a few minutes a week.
- **Kids aged 6–11** (brief) practising on a shared family iMac, a school Chromebook, an iPhone, or an iPad. Short daily sessions, often with a parent nearby but not hovering. Many are early readers and slow, deliberate typists; on touch devices they hunt for keys.

## Product Purpose

Help a family keep a small daily habit: weekly spelling tests read aloud (word → sentence → word, one retry), a Learn mode with fading letter cues, Bible verse memorisation with progressive blanks, and progress a parent can review. Success is a kid finishing today's practice on their own and a parent seeing what still needs work.

## Positioning

Built by a parent for his own kids and shared free (MIT). No accounts, no email, no ads, no analytics: a Family Code opens practice, a Parent PIN protects edits. Parents paste their own verse wording, so there is no translation licensing and no content feed.

## Operating Context

- Spelling lists arrive weekly from school; a parent types or pastes them with optional sentences.
- Practice happens at home, at a desk or on the couch, sometimes with a sibling waiting. Audio is central: the word is spoken, so the screen must stay calm while listening.
- Devices vary from a 27" iMac with a physical keyboard to an iPhone held in small hands.
- Family codes are printed and kept on the fridge or in a drawer; losing them loses access.

## Capabilities and Constraints

- Vanilla JS, no build step, zero npm runtime dependencies; strict CSP (`script-src 'self'`, no third-party requests, no external fonts).
- Collect only first names/nicknames and optional grade labels. Parent-managed family use only, not classrooms.
- Speech: cloud voice with device-voice fallback; sounds must never play before a user gesture.
- Practice data loads and saves online only; the PWA caches the public shell only.
- Limits per family are bounded (10 kids, 200 lists, 300 verses, etc.).

## Brand Commitments

- Name: Family Practice. Hosted at spelling.jesklabs.com.
- Voice (brief): warm, calm, focused, trustworthy. Christian-friendly but not churchy. Not childish or cartoony, and not corporate SaaS.
- Encouraging copy that treats mistakes as part of learning ("Almost. Listen once more").
- Sister app Incord (also the maintainer's, MIT) sets the expectation for on-screen keyboard feel, key sounds, and haptics (brief).

## Evidence on Hand

- Real product flows and copy in `cloudflare/public/app.js`.
- Sample content: fictional kids (Sam, Maya, Alex) and public-domain KJV verses only.
- No testimonials, user counts, school endorsements, or reviews exist; do not invent them.

## Product Principles

1. One thing at a time for the child: one word, one action, one clear next step.
2. The parent sets it up once a week; everything else should be self-serve for a 7-year-old.
3. Privacy is the product: nothing collected that a family would hesitate to hand a stranger.
4. Mistakes are practice, never failure; feedback is gentle and specific.
5. Works on whatever device the family already owns.

## Accessibility & Inclusion

- Young and emerging readers: large type for target words, short sentences, audio for every prompt.
- Touch targets at least 44px (larger on practice screens); visible focus for keyboard users.
- Body text contrast at least 4.5:1; respect reduced motion; feedback never relies on colour alone.
