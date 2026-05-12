-- 028_daily_coacher_tips_remaining.sql
-- Seed approved tips for the remaining 13 Daily Coacher topics:
--   training, recovery, mindset, motivation, accountability,
--   progress_tracking, meeting_prep, meeting_followup, retention,
--   celebration, recalibration, onboarding_momentum, lifestyle_integration.
--
-- 15 tips per topic, mix of universal (no tags) and tagged. User opted to
-- ship all 14 topics now and refine via the (future) admin UI rather than
-- approve each tip individually. Quality is "good enough to launch, refine
-- in production."
--
-- Hard rules verified across all 195 tips:
--   - No em-dashes (U+2014) or en-dashes (U+2013)
--   - No specific macros, calorie counts, or weight measurements
--   - No Everfit references

BEGIN;

-- ===========================================================================
-- TRAINING (15)
-- ===========================================================================
INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved) VALUES
('training', 'Consistency over intensity always wins. A B-effort workout you actually do beats an A-effort workout you skip.', '[]'::jsonb, 2, TRUE),
('training', 'Form is the foundation. If a lift starts to break down, drop the weight. The body remembers good reps, not heavy reps with bad form.', '[]'::jsonb, 2, TRUE),
('training', 'Progressive overload doesn''t always mean adding weight. More reps, slower tempo, better range, shorter rest, all count as progress.', '[]'::jsonb, 1, TRUE),
('training', 'Compound lifts (squat, hinge, push, pull) give the best return per minute spent. Build the week around them.', '[]'::jsonb, 1, TRUE),
('training', 'Rest between sets is part of the program. Resting properly lets you bring real intensity to the next set.', '[]'::jsonb, 1, TRUE),
('training', 'Deload weeks are a feature. Pulling intensity back every 4-6 weeks lets adaptation actually happen.', '[]'::jsonb, 1, TRUE),
('training', 'Keep the weights heavy during a deficit. Strength is what tells the body to keep muscle while fat comes off.', '["fat_loss"]'::jsonb, 1, TRUE),
('training', 'Sleep is more anabolic than an extra workout. If you''re choosing between a session and a full night, take the sleep.', '["muscle_gain"]'::jsonb, 1, TRUE),
('training', 'A missed workout doesn''t ruin a week. Two missed workouts don''t ruin a month. The pattern matters more than any single day.', '[]'::jsonb, 2, TRUE),
('training', 'Early on, the goal is showing up reliably. Don''t worry about hitting PRs in week one. The body needs reps to get good at the movements.', '["phase_onboarding"]'::jsonb, 1, TRUE),
('training', 'When sleep is short, lean toward lower intensity sessions and protect form. Junk volume on no sleep is asking for an injury.', '["low_sleep"]'::jsonb, 1, TRUE),
('training', 'Warm up like you mean it. Five focused minutes saves five weeks of an injury.', '[]'::jsonb, 1, TRUE),
('training', 'Track something simple (the weights you used, how it felt). Over time the trend tells you more than any single workout could.', '[]'::jsonb, 1, TRUE),
('training', 'Build muscle in months, not weeks. The body composition shifts you want take patience and steady training.', '["recomp"]'::jsonb, 1, TRUE),
('training', 'If a workout feels off mid-session, it''s okay to stop. Listening to the body is part of training, not a failure to push.', '[]'::jsonb, 1, TRUE);

-- ===========================================================================
-- RECOVERY (15)
-- ===========================================================================
INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved) VALUES
('recovery', 'Sleep is the cheapest, highest-return performance enhancer that exists. Protect the bedtime more than any supplement.', '[]'::jsonb, 2, TRUE),
('recovery', 'A daily walk does more for recovery than most people give it credit for. Low-intensity movement clears the system without taxing it.', '[]'::jsonb, 2, TRUE),
('recovery', 'Stress and training stress stack. If life is loud, training should get quieter, not the other way around.', '[]'::jsonb, 1, TRUE),
('recovery', 'Soreness isn''t the metric. You can have a great session with no soreness and a wasted session with massive soreness. Watch performance, not pain.', '[]'::jsonb, 1, TRUE),
('recovery', 'Hydration matters for recovery as much as for training. Going to bed dehydrated tanks how you feel the next day.', '[]'::jsonb, 1, TRUE),
('recovery', 'A hot shower before bed can help wind down. A cold rinse first thing in the morning can help wake up. Both are nearly free.', '[]'::jsonb, 1, TRUE),
('recovery', 'Mobility doesn''t need to be elaborate. Five focused minutes after training, hitting the spots that feel tight, beats a 45-minute routine you''ll never do.', '[]'::jsonb, 1, TRUE),
('recovery', 'Front-load any high-intensity work earlier in the day when sleep is short. Late evening workouts on top of poor sleep wreck the next day too.', '["low_sleep"]'::jsonb, 1, TRUE),
('recovery', 'Active recovery on off days (walking, easy mobility, time outside) beats total couch time for how the next session will feel.', '[]'::jsonb, 1, TRUE),
('recovery', 'Stress eating, stress scrolling, stress training. If you notice the pattern, the lever isn''t the behavior, it''s the underlying stress.', '[]'::jsonb, 1, TRUE),
('recovery', 'A deficit makes recovery slower. Protect sleep harder than usual when fat loss is the goal.', '["fat_loss"]'::jsonb, 1, TRUE),
('recovery', 'Building muscle requires margin. If recovery feels short on every session, the body is telling you to either eat more, sleep more, or train less.', '["muscle_gain"]'::jsonb, 1, TRUE),
('recovery', 'Resting heart rate trending up over a week is a real signal. The body is asking for a deload before you "feel" the need for one.', '[]'::jsonb, 1, TRUE),
('recovery', 'Time outside (sunlight, fresh air, anything not a screen) regulates more than mood. Sleep, hormones, energy all benefit.', '[]'::jsonb, 1, TRUE),
('recovery', 'Recovery isn''t a break from training. It''s where the training actually does its work.', '[]'::jsonb, 2, TRUE);

-- ===========================================================================
-- MINDSET (15)
-- ===========================================================================
INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved) VALUES
('mindset', 'One bad day is a bad day. Two bad weeks is data. Don''t make a single decision based on a single day''s mood.', '[]'::jsonb, 2, TRUE),
('mindset', 'Become someone who trains, not someone who is trying to lose weight. The identity shift is what makes the work stick.', '[]'::jsonb, 2, TRUE),
('mindset', 'Compounding doesn''t feel like much until it suddenly does. Six weeks of consistent reps will look like one big leap when you turn around.', '[]'::jsonb, 1, TRUE),
('mindset', 'Your inner monologue around food and training shapes your behavior more than any plan does. Notice the language you use about yourself.', '[]'::jsonb, 1, TRUE),
('mindset', 'If you wouldn''t say it to a friend, don''t say it to yourself. Self-compassion isn''t soft, it''s strategy.', '[]'::jsonb, 1, TRUE),
('mindset', 'Motivation comes after action, not before. Start the workout you don''t feel like doing, and the energy shows up on rep three.', '[]'::jsonb, 1, TRUE),
('mindset', 'The scale is one data point in a system. Sleep, mood, energy, strength, how clothes fit, all matter. Don''t let one number write the whole story.', '["fat_loss"]'::jsonb, 1, TRUE),
('mindset', 'Perfectionism kills consistency. Aim for "did the thing" before you aim for "did the thing perfectly."', '[]'::jsonb, 2, TRUE),
('mindset', 'Comparison is the fastest way to feel worse about real progress. Stay in your own lane.', '[]'::jsonb, 1, TRUE),
('mindset', 'First few weeks, the wins are small (showed up, made the meal, did the warm-up). Acknowledge them. They''re what builds the bigger ones.', '["phase_onboarding"]'::jsonb, 1, TRUE),
('mindset', 'A setback is data, not a verdict. The questions are: what changed, what would help, what''s the smallest next step.', '[]'::jsonb, 1, TRUE),
('mindset', 'You don''t need to feel ready. You need to start. The readiness shows up about a third of the way in.', '[]'::jsonb, 1, TRUE),
('mindset', 'When sleep is short, mood lies. Don''t make big decisions about your goals or your effort on the back of a rough night.', '["low_sleep"]'::jsonb, 1, TRUE),
('mindset', 'This is the messy middle, where the novelty has worn off and the results aren''t loud yet. The work right now is what makes the rest land.', '["phase_mid_program"]'::jsonb, 1, TRUE),
('mindset', 'Your goal is the destination. Your habits are the vehicle. Spend more time on the vehicle and the destination takes care of itself.', '[]'::jsonb, 1, TRUE);

-- ===========================================================================
-- MOTIVATION (15)
-- ===========================================================================
INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved) VALUES
('motivation', 'You don''t need to feel motivated to do the thing. Just start, even badly, and the momentum builds itself.', '[]'::jsonb, 2, TRUE),
('motivation', 'Reconnect to why you started. The original reason is usually still true, even when the energy isn''t.', '[]'::jsonb, 2, TRUE),
('motivation', 'One small win today (one walk, one good meal, one set) is enough to break inertia. Don''t aim for a big day, aim for any day.', '[]'::jsonb, 1, TRUE),
('motivation', 'Identity shapes behavior. Ask "what would the person I''m becoming do right now" and the answer is usually the small thing in front of you.', '[]'::jsonb, 1, TRUE),
('motivation', 'Energy follows action. The workout that feels impossible at 6am feels great by 6:15.', '[]'::jsonb, 1, TRUE),
('motivation', 'Discipline is just remembering what you want. If the moment of choice is hard, the wanting hasn''t been clear enough.', '[]'::jsonb, 1, TRUE),
('motivation', 'Fat loss takes longer than people expect, and that''s fine. The change you actually want is the version of yourself the work is building.', '["fat_loss"]'::jsonb, 1, TRUE),
('motivation', 'Muscle is built in seasons, not sessions. The goal is showing up week after week, not crushing one workout.', '["muscle_gain"]'::jsonb, 1, TRUE),
('motivation', 'When motivation dips, lower the bar, not the intention. A 15-minute workout you actually do beats a 60-minute workout you skip.', '[]'::jsonb, 2, TRUE),
('motivation', 'The middle of any program is the hardest stretch. Keep showing up. The compound effect is doing its work whether you feel it or not.', '["phase_mid_program"]'::jsonb, 1, TRUE),
('motivation', 'Surround the work with cues that make it easy. Lay out clothes, prep one meal, set the alarm. The friction you remove now is energy you''ll have later.', '[]'::jsonb, 1, TRUE),
('motivation', 'Big jumps in progress get you excited. Small daily reps get you to the destination. Don''t chase only the first.', '[]'::jsonb, 1, TRUE),
('motivation', 'A bad week doesn''t undo six good ones. Look at the trend, not the day.', '[]'::jsonb, 1, TRUE),
('motivation', 'The version of you who shows up tired is more impressive than the one who shows up energized. Tired you is who builds the habit.', '[]'::jsonb, 1, TRUE),
('motivation', 'When you''re running on empty, the kindest thing for tomorrow is to do something small today. Even a walk counts.', '["low_sleep"]'::jsonb, 1, TRUE);

-- ===========================================================================
-- ACCOUNTABILITY (15)
-- ===========================================================================
INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved) VALUES
('accountability', 'When something slips, the question isn''t "why did you mess up." It''s "what changed, and what''s the smallest course-correct."', '[]'::jsonb, 2, TRUE),
('accountability', 'We commit to systems, not perfection. If the system isn''t working, we change the system, not your character.', '[]'::jsonb, 2, TRUE),
('accountability', 'A missed week tells us something about the plan, not about you. Let''s figure out what got in the way.', '[]'::jsonb, 1, TRUE),
('accountability', 'Honesty here is the unlock. If you''ve been pretending things are going well, we can''t help. If you tell me the truth, we can.', '[]'::jsonb, 1, TRUE),
('accountability', 'One small recommit beats a guilty silence. Pick one thing to do today and let me know when it''s done.', '[]'::jsonb, 1, TRUE),
('accountability', 'You said you wanted X. The actions this week haven''t matched that. What''s actually happening?', '[]'::jsonb, 1, TRUE),
('accountability', 'I''d rather you tell me you''re struggling than ghost me. We can solve struggling. We can''t solve invisible.', '[]'::jsonb, 1, TRUE),
('accountability', 'Slipping is part of the process. What separates clients who get there from clients who don''t is the speed of the recovery, not the absence of slips.', '[]'::jsonb, 2, TRUE),
('accountability', 'The 1% you do today still counts. Don''t let perfect be the enemy of any.', '[]'::jsonb, 1, TRUE),
('accountability', 'Fat loss requires a level of consistency most people underestimate. If consistency is the gap, that''s where we focus next.', '["fat_loss"]'::jsonb, 1, TRUE),
('accountability', 'Building muscle is showing up to train consistently, eating enough consistently, and sleeping consistently. If one is off, the others can''t carry it.', '["muscle_gain"]'::jsonb, 1, TRUE),
('accountability', 'This is a partnership. I''m not your boss. But I am your coach, which means I''ll tell you when I see a pattern that won''t get you what you said you wanted.', '[]'::jsonb, 1, TRUE),
('accountability', 'What''s the smallest commitment you can make for the next 48 hours that you''re certain you''ll keep? Start there.', '[]'::jsonb, 1, TRUE),
('accountability', 'Sometimes a slip is a sign the goal needs to change. Sometimes the plan. Sometimes life. Worth thinking about which one this is.', '[]'::jsonb, 1, TRUE),
('accountability', 'The first month sets the pattern for the next five. Let''s get the patterns right now while there''s still room to course-correct cheaply.', '["phase_early_program"]'::jsonb, 1, TRUE);

-- ===========================================================================
-- PROGRESS_TRACKING (15)
-- ===========================================================================
INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved) VALUES
('progress_tracking', 'Showing up to track is itself a win. The habit of measuring is what makes any progress visible.', '[]'::jsonb, 2, TRUE),
('progress_tracking', 'Look at the trend, not the snapshot. One week tells you nothing. Three weeks tells you a lot.', '[]'::jsonb, 2, TRUE),
('progress_tracking', 'Non-scale wins matter as much as scale wins. Energy, sleep, strength, fit of clothes, mood, all count.', '[]'::jsonb, 1, TRUE),
('progress_tracking', 'A flat week is normal. Bodies don''t change in a straight line. Stay the course.', '[]'::jsonb, 1, TRUE),
('progress_tracking', 'A weekly average is more honest than any single day. Compare weekly to weekly, not Monday to Monday.', '["fat_loss"]'::jsonb, 1, TRUE),
('progress_tracking', 'Building muscle is slow on a scale. Strength gains and how clothes fit will tell you more than the morning weigh-in.', '["muscle_gain"]'::jsonb, 1, TRUE),
('progress_tracking', 'If the trend is moving, don''t change the variables. If the trend has stalled for 2-3 weeks, then we look at what to adjust.', '[]'::jsonb, 1, TRUE),
('progress_tracking', 'How you feel matters in the data. A week of better sleep, more energy, better mood is real progress, even if the scale didn''t move.', '[]'::jsonb, 1, TRUE),
('progress_tracking', 'The check-in is a conversation, not a report card. Tell me what was hard, not just what was on plan.', '[]'::jsonb, 1, TRUE),
('progress_tracking', 'Photos are usually more honest than the scale. A month of side-by-sides will show you what daily weighing won''t.', '[]'::jsonb, 1, TRUE),
('progress_tracking', 'A bad sleep week affects measurements (water retention, mood, hunger). Don''t read into the scale on a tired week.', '["low_sleep"]'::jsonb, 1, TRUE),
('progress_tracking', 'Weight and effort aren''t the same thing. You can have a great effort week with a flat scale. The work still counts.', '[]'::jsonb, 1, TRUE),
('progress_tracking', 'I''d rather see consistent honest tracking than perfect tracking. Don''t skip a week because you fell off; that''s the week the data matters most.', '[]'::jsonb, 2, TRUE),
('progress_tracking', 'The number on the scale is information, not a verdict. Not your worth, not your discipline, not your future. Just data.', '[]'::jsonb, 1, TRUE),
('progress_tracking', 'At this stage, watch the cumulative change, not the weekly. You''ve earned the right to look at the bigger picture.', '["phase_late_mid"]'::jsonb, 1, TRUE);

-- ===========================================================================
-- MEETING_PREP (15)
-- ===========================================================================
INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved) VALUES
('meeting_prep', 'Before our call, jot down one thing that''s working and one thing that isn''t. Just having those ready makes the meeting twice as useful.', '[]'::jsonb, 2, TRUE),
('meeting_prep', 'Come ready to be honest about what''s been hard. The meeting is the safe place for the things that haven''t gone well.', '[]'::jsonb, 2, TRUE),
('meeting_prep', 'If anything has changed since we last talked (life, schedule, motivation, goals), bring it. Plans bend better when we know early.', '[]'::jsonb, 1, TRUE),
('meeting_prep', 'Think about the next 30 days. What would you want to feel proud of by then?', '[]'::jsonb, 1, TRUE),
('meeting_prep', 'Bring your questions. The dumb ones are usually the most useful, so don''t filter them out.', '[]'::jsonb, 1, TRUE),
('meeting_prep', 'Worth thinking through: what''s been the biggest friction with eating this week? We can work around it together.', '["fat_loss"]'::jsonb, 1, TRUE),
('meeting_prep', 'For the call, think about whether the food and the training are matching up. If one''s lagging, that''s where we''ll focus.', '["muscle_gain"]'::jsonb, 1, TRUE),
('meeting_prep', 'One thing you want me to keep doing, one thing you want me to do differently. That kind of feedback makes everything better.', '[]'::jsonb, 1, TRUE),
('meeting_prep', 'Look at your last week or two. Where did the energy show up easily, and where did it disappear? Those answers are gold.', '[]'::jsonb, 1, TRUE),
('meeting_prep', 'Don''t prep too hard. The meeting is also a place to think out loud, not a presentation.', '[]'::jsonb, 1, TRUE),
('meeting_prep', 'If there''s a goal you''ve been quietly thinking about adjusting, bring it. We can talk about whether it makes sense.', '[]'::jsonb, 1, TRUE),
('meeting_prep', 'As we get closer to the end of the program, start thinking about what you want the next chapter to look like. We''ll talk about it.', '["phase_late_mid"]'::jsonb, 1, TRUE),
('meeting_prep', 'If sleep has been off, lead with that on the call. It changes everything else we''ll talk through.', '["low_sleep"]'::jsonb, 1, TRUE),
('meeting_prep', 'Pick one thing you want to walk away from the meeting having decided. That focus alone makes the call more useful.', '[]'::jsonb, 1, TRUE),
('meeting_prep', 'Show up as you are. We don''t need a polished version of the week. The honest version is what helps.', '[]'::jsonb, 1, TRUE);

-- ===========================================================================
-- MEETING_FOLLOWUP (15)
-- ===========================================================================
INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved) VALUES
('meeting_followup', 'Quick recap of what we landed on, so it doesn''t get fuzzy by tomorrow.', '[]'::jsonb, 2, TRUE),
('meeting_followup', 'One specific thing you committed to: lock it in this week. We''ll check in on it next time.', '[]'::jsonb, 2, TRUE),
('meeting_followup', 'You shared something honest in our call. That kind of honesty is what makes coaching actually work. Thanks for that.', '[]'::jsonb, 1, TRUE),
('meeting_followup', 'If anything we discussed feels different now that you''ve sat with it, tell me. It''s normal for clarity to come a day or two later.', '[]'::jsonb, 1, TRUE),
('meeting_followup', 'Don''t carry the whole list out of the meeting. Pick the one or two things that matter most this week.', '[]'::jsonb, 1, TRUE),
('meeting_followup', 'The next two weeks, the goal is to test what we talked about. We''ll regroup and adjust based on what we learn.', '[]'::jsonb, 1, TRUE),
('meeting_followup', 'For the next stretch, the focus is on the eating piece we discussed. Stay the course on training, just adjust the food side.', '["fat_loss"]'::jsonb, 1, TRUE),
('meeting_followup', 'The call confirmed the plan needs to lean a bit harder into one of the three (training, food, sleep). Hit that one this week.', '["muscle_gain"]'::jsonb, 1, TRUE),
('meeting_followup', 'If you get stuck on what we talked about, message me before it becomes a week of struggling. That''s what I''m here for.', '[]'::jsonb, 1, TRUE),
('meeting_followup', 'Quick wins this week build the momentum for the bigger shift. Keep the bar reasonable.', '[]'::jsonb, 1, TRUE),
('meeting_followup', 'I''m sitting with what you shared in our call. We''ll keep coming back to it. It''s worth working through.', '[]'::jsonb, 1, TRUE),
('meeting_followup', 'Notice over this week whether the pattern we identified actually shows up. If it does, we know we found the right thing.', '[]'::jsonb, 1, TRUE),
('meeting_followup', 'Best part of our calls is the moment something clicks. Keep watching for those small clicks this week. Tell me when they happen.', '[]'::jsonb, 1, TRUE),
('meeting_followup', 'We''re in the middle, so the work this week isn''t flashy. It''s about the patterns we just talked about getting reps.', '["phase_mid_program"]'::jsonb, 1, TRUE),
('meeting_followup', 'A short message between calls beats a long silence. Drop me a line mid-week with how it''s landing.', '[]'::jsonb, 1, TRUE);

-- ===========================================================================
-- RETENTION (15)
-- ===========================================================================
INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved) VALUES
('retention', 'You''ve built infrastructure here over the past few months. The habits, the awareness, the patterns. The question now is about what comes next.', '[]'::jsonb, 2, TRUE),
('retention', 'Where you started and where you are now isn''t a small distance. Worth pausing to see it.', '[]'::jsonb, 2, TRUE),
('retention', 'Coaching isn''t a finish line, it''s a partnership. The version of you that started this would be amazed at the version showing up now.', '[]'::jsonb, 1, TRUE),
('retention', 'The work you''re doing is becoming who you are. Continuing isn''t about needing more help. It''s about staying in the rhythm that built this.', '[]'::jsonb, 1, TRUE),
('retention', 'A lot of people stop here and lose what they built. Not because they want to, but because momentum without accountability is hard to hold.', '[]'::jsonb, 1, TRUE),
('retention', 'Want to talk about what staying on this trajectory looks like? No pitch, just a real conversation about what would help next.', '[]'::jsonb, 2, TRUE),
('retention', 'The goals you have now are bigger than the goals you started with. That''s the right kind of problem to have. Let''s talk about chapter two.', '[]'::jsonb, 1, TRUE),
('retention', 'Fat loss is a moment. Maintenance and longevity are the real game. The skills we built here are what protects what you''ve earned.', '["fat_loss"]'::jsonb, 1, TRUE),
('retention', 'Muscle gained but not maintained is muscle lost. The next phase is about cementing what we built, not letting it slip.', '["muscle_gain"]'::jsonb, 1, TRUE),
('retention', 'Open invitation: if you want to keep going, I''d love to. If you''re ready to fly solo, I''ll help you set up a plan you can run with.', '[]'::jsonb, 1, TRUE),
('retention', 'The honest moments we''ve had in this program, the breakthroughs, the slips, are what I love about coaching. Wherever you go next, know that.', '[]'::jsonb, 1, TRUE),
('retention', 'As we close out, the question on the table is: what does six months from now look like, and do you want help getting there?', '["phase_end_game"]'::jsonb, 1, TRUE),
('retention', 'I''ve watched you change real things about how you live. The work you did is yours. What''s next is your call.', '[]'::jsonb, 1, TRUE),
('retention', 'Some clients renew, some don''t. Both are right answers. The one I want is whichever serves you.', '[]'::jsonb, 1, TRUE),
('retention', 'Whatever comes next, I''m rooting for you. If staying in coaching is part of that, let''s find a structure that fits this next phase of your life.', '[]'::jsonb, 1, TRUE);

-- ===========================================================================
-- CELEBRATION (15)
-- ===========================================================================
INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved) VALUES
('celebration', 'This is real. You did the thing. Take a second to feel it.', '[]'::jsonb, 2, TRUE),
('celebration', 'What I want you to notice isn''t just the win, it''s what it took to get there. The reps, the showing up, the not-quitting. That''s what built this.', '[]'::jsonb, 2, TRUE),
('celebration', 'A win like this doesn''t happen by accident. It happens because of the dozens of small decisions you made when no one was watching.', '[]'::jsonb, 1, TRUE),
('celebration', 'I''ve seen this coming for a few weeks. The way you''ve been showing up made it inevitable.', '[]'::jsonb, 1, TRUE),
('celebration', 'This isn''t just a number changing. It''s a body that''s stronger, more capable, and built to hold the result. Different than crash diets.', '["fat_loss"]'::jsonb, 1, TRUE),
('celebration', 'The strength you''re feeling didn''t show up overnight. You built it. That''s a different kind of pride than just being told you look good.', '["muscle_gain"]'::jsonb, 1, TRUE),
('celebration', 'Wins like this make the next ones easier. You now have proof that the work works.', '[]'::jsonb, 1, TRUE),
('celebration', 'I don''t say this lightly: you''ve done what most people don''t. Acknowledge it. Then we''ll keep going.', '[]'::jsonb, 1, TRUE),
('celebration', 'The version of you from six months ago is going to be glad you didn''t quit. Hold onto that.', '[]'::jsonb, 1, TRUE),
('celebration', 'This wasn''t luck or a fluke or the program. This was you, choosing the harder thing over and over until it became normal.', '[]'::jsonb, 1, TRUE),
('celebration', 'You''ve earned the right to enjoy this for a beat. The next thing can wait until tomorrow.', '[]'::jsonb, 2, TRUE),
('celebration', 'Wins at this stage of the program are extra meaningful. The novelty is gone, the work is just the work, and you''re still showing up. Don''t take that for granted.', '["phase_late_mid"]'::jsonb, 1, TRUE),
('celebration', 'This is the proof. The proof that you can do hard things, sustainably, on the timeline life actually allows.', '[]'::jsonb, 1, TRUE),
('celebration', 'Real talk: I''m proud of you. Not in a corporate-coach way, in a "I''ve watched you do something hard" way.', '[]'::jsonb, 1, TRUE),
('celebration', 'This belongs to you. The plan helped, the structure helped, but you''re the one who showed up. Don''t outsource the credit.', '[]'::jsonb, 1, TRUE);

-- ===========================================================================
-- RECALIBRATION (15)
-- ===========================================================================
INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved) VALUES
('recalibration', 'Plans are supposed to bend to life, not the other way around. Let''s adjust based on what''s actually happening.', '[]'::jsonb, 2, TRUE),
('recalibration', 'Something has shifted (your schedule, your goal, your energy, your priorities). Tell me what, and we''ll redesign the parts that aren''t fitting.', '[]'::jsonb, 2, TRUE),
('recalibration', 'A plan that doesn''t get adjusted is a plan that gets abandoned. So the fact that we''re having this conversation is healthy.', '[]'::jsonb, 1, TRUE),
('recalibration', 'What''s working: keep doing it. What''s not: tell me. The changes don''t have to be big to make a real difference.', '[]'::jsonb, 1, TRUE),
('recalibration', 'Goals are allowed to evolve. If the original target doesn''t feel right anymore, let''s name what does and build toward that instead.', '[]'::jsonb, 1, TRUE),
('recalibration', 'Sometimes the plan is right and life is the variable. Sometimes life is right and the plan is the variable. Worth figuring out which we''re dealing with.', '[]'::jsonb, 1, TRUE),
('recalibration', 'If fat loss has stalled, it''s usually one of three things: more food than we think, less movement than we think, or stress and sleep are blocking it. Let''s check each.', '["fat_loss"]'::jsonb, 1, TRUE),
('recalibration', 'If muscle gain has stalled, the answer is usually more food, more sleep, or more recovery between sessions. Sometimes all three.', '["muscle_gain"]'::jsonb, 1, TRUE),
('recalibration', 'An adjustment isn''t admitting the plan failed. It''s the plan working as intended.', '[]'::jsonb, 2, TRUE),
('recalibration', 'We''re at the point where we have enough data to make smart adjustments. Tell me what''s been showing up and we''ll tweak from there.', '["phase_mid_program"]'::jsonb, 1, TRUE),
('recalibration', 'Sometimes recalibration means doing less, not more. Less restrictive food, fewer training days, less hard accountability. Don''t assume the answer is to push harder.', '[]'::jsonb, 1, TRUE),
('recalibration', 'One change at a time. If we adjust three things at once, we won''t know what worked.', '[]'::jsonb, 1, TRUE),
('recalibration', 'What would you change about how this is going if you could? That answer is usually the right starting point.', '[]'::jsonb, 1, TRUE),
('recalibration', 'Life is going to keep happening. Building the muscle of adjusting in real time is part of what makes long-term progress possible.', '[]'::jsonb, 1, TRUE),
('recalibration', 'If sleep has been off for a while, that''s the recalibration. We''ll work around it until you can get the rest back, not pretend it doesn''t exist.', '["low_sleep"]'::jsonb, 1, TRUE);

-- ===========================================================================
-- ONBOARDING_MOMENTUM (15)
-- ===========================================================================
INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved) VALUES
('onboarding_momentum', 'Welcome. The first two weeks are about building rhythm, not crushing PRs. Show up imperfectly and you''ll be ahead of most.', '[]'::jsonb, 2, TRUE),
('onboarding_momentum', 'This first stretch is going to feel weird before it feels natural. That''s normal. Push through the awkward.', '[]'::jsonb, 2, TRUE),
('onboarding_momentum', 'One small habit this week beats five big ones you can''t sustain. What''s one thing you can lock in?', '[]'::jsonb, 1, TRUE),
('onboarding_momentum', 'Don''t try to be the perfect client out of the gate. The clients who succeed are the ones who stay honest about what''s hard.', '[]'::jsonb, 1, TRUE),
('onboarding_momentum', 'Ask the dumb questions. Now is the cheapest time to ask them, while everything is still being calibrated.', '[]'::jsonb, 1, TRUE),
('onboarding_momentum', 'Day one of fat loss isn''t about the deficit. It''s about getting the basics dialed (protein, sleep, water, walking). The deficit takes care of itself if those are in.', '["fat_loss"]'::jsonb, 1, TRUE),
('onboarding_momentum', 'Building muscle starts with building the eating habit. Most beginners under-eat. Let''s make sure that''s not what trips you up.', '["muscle_gain"]'::jsonb, 1, TRUE),
('onboarding_momentum', 'Notice what''s hard in these first weeks. Those are the things we''ll solve together. Don''t hide them, share them.', '[]'::jsonb, 1, TRUE),
('onboarding_momentum', 'You don''t have to figure out the whole journey today. You just have to do this week well. Then we''ll do the next one.', '[]'::jsonb, 1, TRUE),
('onboarding_momentum', 'The wins in week one are small (showed up, did the workout, made the meal). Mark them. They''re what builds week ten.', '[]'::jsonb, 1, TRUE),
('onboarding_momentum', 'If cooking is going to be the friction point, let''s solve that first. Tell me what''s realistic, and we''ll build food around what you''ll actually eat.', '["limited_cooking"]'::jsonb, 1, TRUE),
('onboarding_momentum', 'Energy might be all over the place in these first weeks (good and bad). Bodies adapt, then settle. Trust the process.', '[]'::jsonb, 1, TRUE),
('onboarding_momentum', 'I''d rather you message me with a small question than wait and let it become a big one. That''s why I''m here.', '[]'::jsonb, 1, TRUE),
('onboarding_momentum', 'Most of what you''ll learn in this program isn''t in week one. Be patient. The compound effect is going to surprise you.', '[]'::jsonb, 1, TRUE),
('onboarding_momentum', 'You started this program for a reason. Whatever that reason was, we''ll come back to it any time motivation dips.', '[]'::jsonb, 1, TRUE);

-- ===========================================================================
-- LIFESTYLE_INTEGRATION (15)
-- ===========================================================================
INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved) VALUES
('lifestyle_integration', 'Habit stack a new behavior onto something you already do. After morning coffee, do five minutes of mobility. After dinner, walk for 15 minutes. The trigger is what makes it stick.', '[]'::jsonb, 2, TRUE),
('lifestyle_integration', 'Lower the bar to the point of "I''d be embarrassed not to do it." Two minutes of stretching is easier to start than 20.', '[]'::jsonb, 2, TRUE),
('lifestyle_integration', 'One new habit at a time. More than one and you''ll do none.', '[]'::jsonb, 2, TRUE),
('lifestyle_integration', 'A daily walk is an underrated health lever. Even 10 minutes after a meal moves a lot.', '[]'::jsonb, 1, TRUE),
('lifestyle_integration', 'Make the good thing easier and the hard thing harder. Sneakers by the door, water bottle on the desk, snacks out of sight.', '[]'::jsonb, 1, TRUE),
('lifestyle_integration', 'A glass of water by the bed each night is a tiny habit that compounds into better mornings.', '[]'::jsonb, 1, TRUE),
('lifestyle_integration', 'Treat the new habit as an experiment for two weeks, not a forever commitment. Easier to start that way.', '[]'::jsonb, 1, TRUE),
('lifestyle_integration', 'If you''ve never been a "morning person", don''t try to become one to fit a workout in. Build the habit at the time of day you have energy.', '[]'::jsonb, 1, TRUE),
('lifestyle_integration', 'Build a wind-down ritual. Even 10 minutes of dim lights and no screen before bed shifts sleep quality more than people expect.', '["low_sleep"]'::jsonb, 1, TRUE),
('lifestyle_integration', 'Pair the new habit with something enjoyable. Listen to a favorite podcast only on walks. The reward makes the habit self-reinforcing.', '[]'::jsonb, 1, TRUE),
('lifestyle_integration', 'Add 1,000 steps to your day before changing anything else. Simple, free, compounds without needing willpower.', '["fat_loss"]'::jsonb, 1, TRUE),
('lifestyle_integration', 'Add a protein source to a meal you already eat (eggs at breakfast, Greek yogurt mid-morning). Don''t restructure the day, just upgrade what''s already there.', '["muscle_gain"]'::jsonb, 1, TRUE),
('lifestyle_integration', 'Notice what time of day your willpower is highest. Stack the hardest habits there.', '[]'::jsonb, 1, TRUE),
('lifestyle_integration', 'A weekly meal-prep block (even 30 minutes) saves a dozen small willpower decisions during the week.', '[]'::jsonb, 1, TRUE),
('lifestyle_integration', 'The habit you build is more important than the habit you intended. Pick one that fits your actual life, not your ideal life.', '[]'::jsonb, 1, TRUE);

COMMIT;
