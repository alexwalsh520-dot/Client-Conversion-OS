// Daily Coacher: Nutrition topic spec.
//
// Spec covers: Claude's voice/focus when drafting Nutrition messages, plus
// the logic for deriving client-context tags from the intake form so we can
// filter `tips_library` to relevant tips per draft.
//
// Hard rule (also in the base system prompt; reinforced here): NO specific
// macros, calories, or measurements. The intake form contains numbers — the
// draft must not pass them through.

import type { SummaryInputs } from "../summary-inputs";
import type { TopicSpec } from "./registry";

export const NUTRITION_SPEC: TopicSpec = {
  systemPromptAddendum: `TOPIC-SPECIFIC GUIDANCE (Nutrition):

This is a Nutrition message. The coach is checking in on the client's eating habits, addressing a friction point, or reinforcing a principle.

ANGLES TO PICK FROM (let the client's recent state and tips guide which fits):
  - Habit consistency over perfection
  - Specific friction the client mentioned (eating out, work meals, weekends, snacking, alcohol, sleep)
  - Protein-anchoring or vegetable-density without quoting amounts
  - Meal-prep or prep-light strategies
  - Mindset around food (shifting from restriction to sustainability, from scale obsession to trend tracking, etc.)

REMINDERS:
  - The client may have nutrition intake info on file (food preferences, allergies, lifestyle constraints). Reference it where it makes the message land, but never quote specific numbers from it.
  - If the client mentioned a problem in recent messages, address THAT problem before suggesting anything new.
  - If they're going well, acknowledge and reinforce. Don't add a new ask just to fill space.
  - Do NOT suggest specific foods unless the tip you're using calls them out and they fit the client's preferences/restrictions.`,

  deriveClientTags: (inputs: SummaryInputs): string[] => {
    const tags: string[] = [];
    const intake = inputs.intake;
    if (!intake) return tags;

    const goal = (intake.fitness_goal || "").toLowerCase();
    if (/lose|fat\s*loss|cut/.test(goal)) tags.push("fat_loss");
    if (/gain|build|bulk|muscle/.test(goal)) tags.push("muscle_gain");
    if (/recomp|tone|lean/.test(goal)) tags.push("recomp");
    if (/maintain/.test(goal)) tags.push("maintenance");

    const allergies = (intake.allergies || "").toLowerCase();
    if (/dairy|lactose/.test(allergies)) tags.push("dairy_free");
    if (/gluten|wheat/.test(allergies)) tags.push("gluten_free");
    if (/nut\b|peanut|tree\s*nut/.test(allergies)) tags.push("nut_free");

    const avoid = (intake.foods_avoid || "").toLowerCase();
    if (/vegetarian|vegan|plant/.test(avoid + " " + (intake.protein_preferences || "").toLowerCase())) {
      tags.push("plant_based");
    }

    const cook = (intake.can_cook || "").toLowerCase();
    if (/no\b|barely|rarely|hate|don'?t/.test(cook)) tags.push("limited_cooking");
    if (/yes|love|enjoy|some/.test(cook)) tags.push("cooks_at_home");

    const meals = (intake.daily_meals_description || "") + " " + (intake.daily_meals_description_2 || "");
    if (/restaurant|eat\s*out|takeout|fast\s*food|cafe|cafeteria/i.test(meals)) {
      tags.push("eats_out_often");
    }
    if (/meal\s*kit|meal\s*service|hellofresh|factor|trifecta/i.test(meals)) {
      tags.push("uses_meal_service");
    }
    if (/snack|graze|crav/i.test(meals)) tags.push("snacker");

    const sleep = (intake.sleep_hours || "").toLowerCase();
    if (/[1-5](?!\d)|less\s*than\s*6/.test(sleep)) tags.push("low_sleep");

    return tags;
  },
};
