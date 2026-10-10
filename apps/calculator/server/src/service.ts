import {
  calculate,
  CalculationError,
  type CalculationResult,
} from "@t-box/calculator-contracts";
import { ApplicationError } from "@t-box/app-server-sdk";
export function runCalculation(input: unknown): CalculationResult {
  try {
    return calculate(input);
  } catch (error) {
    if (error instanceof CalculationError)
      throw new ApplicationError("INVALID_CALCULATION", error.message);
    throw error;
  }
}
