---
participant: Marcus Webb
role: IT Support Specialist
office: Campus Technology Help Desk
years_at_university: 4
interviewer: K. Nakamura (UX Research)
date: 2026-06-12
duration: 25 min
notes: Fields Compass-related tickets from students, faculty, and staff campus-wide
---

# Interview: Marcus Webb (IT Support Specialist, Help Desk)

**Interviewer:** You're in a unique position — you see Compass problems from every type of user. What are the most common tickets you get?

**Marcus:** By far, login and session issues. "I got logged out and lost my work" is probably a third of all Compass tickets we receive. It seems to hit faculty filling out long forms the hardest — grade entry, budget requests, that kind of thing.

**Interviewer:** Do you know the root cause?

**Marcus:** Our working theory, though I'm not on the backend team, is an aggressive session timeout that doesn't account for active typing, only clicks. So someone can be actively working in a text field for twenty minutes and get logged out mid-sentence because they haven't clicked anything.

**Interviewer:** What's the second most common category?

**Marcus:** Navigation confusion, especially from new students and less tech-comfortable faculty. "I can't find X" tickets. The dashboard has a lot of tiles and the labeling doesn't always match what people are searching for in their heads — someone looking for their class schedule might search for "schedule," but it's filed under "Enrollment."

**Interviewer:** How do you typically resolve those?

**Marcus:** We just walk them through it, remote screen-share usually. It's a five-minute fix each time, but it's the same five minutes over and over across hundreds of people, which suggests it's really a labeling problem, not an individual-user problem.

**Interviewer:** Any tickets that stand out as more serious?

**Marcus:** We had a cluster of tickets during the first week of registration in January about the system timing out under load — that's the one that made it into a formal incident report. It's been better since, though we still see spikes right when registration windows open each morning.

**Interviewer:** Anything that's actually reduced your ticket volume compared to the old system?

**Marcus:** Password resets, weirdly. Compass integrated with the university's single sign-on for the reset flow, so that dropped a lot. It's really just the session timeout and the navigation labeling that generate the bulk of what we see now.

**Interviewer:** If the Compass team could only fix two things this year, what would you tell them?

**Marcus:** Fix the session timeout to account for active use, not just clicks. And do a full pass on dashboard labeling using the actual search terms people type into our ticket system — we have hundreds of examples of what people call things versus what Compass calls them.
