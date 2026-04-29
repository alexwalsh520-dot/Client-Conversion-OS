/**
 * Coach handoff prompt — main entry.
 *
 * Composes the per-section markdown into a single string the coach pastes
 * into Claude.ai. Always called at plan-creation time (regardless of
 * whether complexity_recommended fires) so the persisted row carries the
 * prompt and the coach UI can display it on demand.
 */

import type { WeekPlanSuccess } from "../picker";
import type { AuditResult } from "../audit/types";
import type { MacroTargets } from "../../macro-calculator";
import type { BuildSpec, MealDistribution } from "../types";
import type { IngredientNutrition } from "../solver/types";
import type { VerifyMacrosResult } from "../macro-verifier";
import type { ComplexityDetail } from "./complexity-detector";
import {
  closingSection,
  constraintsSection,
  CoachProfileInput,
  currentPlanSection,
  flaggedIssuesSection,
  headerSection,
  outputSchemaSection,
  targetsSection,
  clientProfileSection,
} from "./prompt-template";
import { buildSlugList } from "../llm-meal-generator/slug-list";

export interface GenerateCoachHandoffArgs {
  profile: CoachProfileInput;
  targets: { training: MacroTargets; rest: MacroTargets };
  distribution: MealDistribution;
  buildSpec: BuildSpec;
  hardExclude: ReadonlySet<string>;
  planResult: WeekPlanSuccess;
  audit: AuditResult;
  verifyResult: VerifyMacrosResult;
  complexity: ComplexityDetail;
  nutritionMap: ReadonlyMap<string, IngredientNutrition>;
}

export async function generateCoachHandoffPrompt(
  args: GenerateCoachHandoffArgs,
): Promise<string> {
  const slugListBlock = await buildSlugList({ hardExclude: args.hardExclude });

  const sections: string[] = [
    headerSection(),
    clientProfileSection(args.profile),
    targetsSection({
      training: args.targets.training,
      rest: args.targets.rest,
      distribution: args.distribution,
    }),
    currentPlanSection(args.planResult, args.nutritionMap),
    flaggedIssuesSection({
      audit: args.audit,
      verifyResult: args.verifyResult,
      complexity: args.complexity,
      planResult: args.planResult,
      nutritionMap: args.nutritionMap,
      targets: args.targets,
    }),
    constraintsSection({
      buildSpec: args.buildSpec,
      profile: args.profile,
      hardExclude: args.hardExclude,
    }),
    "## Approved ingredient list\n" + slugListBlock + "\n",
    outputSchemaSection(),
    closingSection(),
  ];

  return sections.join("\n");
}
