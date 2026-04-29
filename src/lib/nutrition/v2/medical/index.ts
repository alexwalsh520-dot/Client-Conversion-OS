/**
 * Barrel export for all 8 medical rules.
 */

import { MedicalFlag, type MedicalRule } from "../types";

import medical_hbp from "./medical_hbp";
import medical_diabetes_t2 from "./medical_diabetes_t2";
import medical_kidney from "./medical_kidney";
import medical_ibs from "./medical_ibs";
import medical_pregnant_nursing from "./medical_pregnant_nursing";
import medical_gout from "./medical_gout";
import medical_reflux from "./medical_reflux";
import medical_pcos from "./medical_pcos";

export const ALL_MEDICAL_RULES: Record<MedicalFlag, MedicalRule> = {
  [MedicalFlag.HBP]: medical_hbp,
  [MedicalFlag.DIABETES_T2]: medical_diabetes_t2,
  [MedicalFlag.KIDNEY]: medical_kidney,
  [MedicalFlag.IBS]: medical_ibs,
  [MedicalFlag.PREGNANT_NURSING]: medical_pregnant_nursing,
  [MedicalFlag.GOUT]: medical_gout,
  [MedicalFlag.REFLUX]: medical_reflux,
  [MedicalFlag.PCOS]: medical_pcos,
};

export function getMedicalRule(flag: MedicalFlag): MedicalRule {
  return ALL_MEDICAL_RULES[flag];
}
