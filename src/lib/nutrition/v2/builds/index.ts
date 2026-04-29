/**
 * Barrel export for all 6 build specs.
 */

import { BuildType, type BuildSpec } from "../types";

import recomp from "./recomp";
import shred from "./shred";
import bulk from "./bulk";
import lean_gain from "./lean_gain";
import endurance from "./endurance";
import maintain from "./maintain";

export const ALL_BUILDS: Record<BuildType, BuildSpec> = {
  [BuildType.RECOMP]: recomp,
  [BuildType.SHRED]: shred,
  [BuildType.BULK]: bulk,
  [BuildType.LEAN_GAIN]: lean_gain,
  [BuildType.ENDURANCE]: endurance,
  [BuildType.MAINTAIN]: maintain,
};

export function getBuild(id: BuildType): BuildSpec {
  return ALL_BUILDS[id];
}
