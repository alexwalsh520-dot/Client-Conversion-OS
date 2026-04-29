/**
 * Coach handoff — barrel.
 */

export {
  detectComplexity,
  HIGH_CAL_BUILD_THRESHOLD,
  SODIUM_NEAR_CEILING_THRESHOLD_MG,
} from "./complexity-detector";
export type {
  AnchorAtCap,
  ComplexityDetail,
  ComplexityReason,
  DetectComplexityArgs,
  NearBlockSodiumDay,
} from "./complexity-detector";

export { generateCoachHandoffPrompt } from "./generate-handoff-prompt";
export type { GenerateCoachHandoffArgs } from "./generate-handoff-prompt";

export { CORRECTION_SCHEMA } from "./correction-schema";

// Section builders (occasionally useful in tests)
export {
  clientProfileSection,
  closingSection,
  constraintsSection,
  currentPlanSection,
  flaggedIssuesSection,
  headerSection,
  outputSchemaSection,
  targetsSection,
} from "./prompt-template";
export type { CoachProfileInput } from "./prompt-template";
