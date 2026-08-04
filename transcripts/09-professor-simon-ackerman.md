---
participant: Dr. Simon Ackerman
role: Professor
department: Computer Science
years_at_university: 6
interviewer: K. Nakamura (UX Research)
date: 2026-06-09
duration: 27 min
---

# Interview: Dr. Simon Ackerman (Professor, Computer Science)

**Interviewer:** Given your background, I'd love your take on Compass from a more technical angle.

**Simon:** Sure, happy to nerd out about this. On the whole I think the underlying architecture is a real improvement — it's clearly a unified data model instead of five bolted-together legacy systems, which is what we had before.

**Interviewer:** What gives you that impression?

**Simon:** Little things. When I update a course's room assignment, it updates everywhere — the student view, the room booking calendar, the printed schedule export — instantly. In the old system those were separate databases that synced overnight, so you'd see contradictions for a day.

**Interviewer:** Any technical frustrations, then?

**Simon:** Single sign-on is inconsistent. I get logged out of Compass randomly, sometimes mid-task, while staying logged into every other university system. My guess is a session timeout misconfiguration, but from a user's side it just looks like random data loss.

**Interviewer:** Has that caused you to lose work?

**Simon:** Twice. Once while building a complex syllabus schedule with recurring exceptions for holidays — session expired, and none of it had saved. That's a rough experience for anyone, but especially a first-time user.

**Interviewer:** Anything from a data or reporting perspective?

**Simon:** I'd love an API or even a clean CSV export for my own research on enrollment trends in our program. Right now I'm screen-scraping tables, which is silly for a system this modern.

**Interviewer:** Any final thoughts?

**Simon:** Fix the session timeout and add an export option, and I think this becomes a genuinely well-regarded system instead of a tolerated one.
