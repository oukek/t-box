import {
  calculatorCatalog,
  calculatorManifest,
  calculatorInputSchema,
  parseCalculatorParams,
  CalculationError,
} from "@t-box/calculator-contracts";
import type {
  ApplicationModule,
  ApplicationToolRegistration,
} from "@t-box/app-server-sdk";
import { definition, ApplicationError } from "@t-box/app-server-sdk";

import { runCalculation } from "./service.js";
export function createCalculatorModule(): ApplicationModule {
  const tools: Record<string, ApplicationToolRegistration> = {};
  for (const entry of calculatorCatalog) {
    const name = `calculator_${entry.id}`;
    tools[name] = {
      title: entry.title,
      execution: "server",
      effect: "read",
      successSummary: `已完成${entry.title}`,
      definition: definition(
        name,
        `${entry.description}。${entry.note} 数值用字符串传入；条件不适用的字段传 null，其他字段必须填写，不能猜测缺失数据。`,
        calculatorInputSchema(entry.id),
      ),
      async handler(values, context) {
        context.signal.throwIfAborted();
        return runCalculation({ kind: entry.id, values });
      },
    };
  }
  tools.calculator_fill_expression = {
    title: "填入计算器",
    execution: "client",
    effect: "ui",
    clientAction: "application_invoke",
    successSummary: "表达式已填入计算器",
    definition: definition(
      "calculator_fill_expression",
      "将已确认的表达式填入计算器页面，方便用户继续操作。数学结果仍应使用后端计算工具。",
      {
        kind: { type: "string", enum: ["basic", "scientific"] },
        expression: { type: "string", maxLength: 2000 },
      },
    ),
    normalizeClientArguments(value) {
      return parseCalculatorParams(value);
    },
    sanitizeClientResult(result) {
      return result.ok ? { ok: true, data: { filled: true } } : result;
    },
  };
  return {
    id: "calculator",
    contractVersion: "1.0",
    manifest: calculatorManifest,
    tools,
    interactions: [],
    skills: {
      calculation: {
        title: "数学计算",
        description: "可靠执行科学运算、方程、矩阵、数论和数学分析。",
        version: "1.0.0",
        tools: Object.keys(tools),
        instructions:
          "所有数学结果通过计算工具验证，不靠口算编造。根据任务选取对应工具；未明确的参数向用户确认。区分 DEG 和 RAD。矩阵逐行输入，系数顺序按工具说明；结果有浮点近似时明确说明。计算只读，不会记账或修改其他应用。需要展示页面时 app_open 打开 calculator，可携带 kind，基础或科学计算还可携带 expression。",
      },
    },
    agents: [
      {
        id: "calculator",
        title: "数学助手",
        description: "科学计算、代数求解、几何、统计与数论",
        version: "1.0.0",
        skillIds: ["calculation"],
        instructions:
          "先明确数学条件、角度单位和计算目标，再选择计算工具。说明采用的公式及结果；数值近似不应说成符号证明。不处理贷款、支付或日期等业务。",
      },
    ],
    navigation: {
      properties: {
        kind: {
          anyOf: [
            { type: "string", enum: calculatorCatalog.map((c) => c.id) },
            { type: "null" },
          ],
        },
        expression: {
          anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }],
        },
      },
      parse(value) {
        try {
          return parseCalculatorParams(value);
        } catch (error) {
          if (error instanceof CalculationError)
            throw new ApplicationError("INVALID_CALCULATION", error.message);
          throw error;
        }
      },
    },
  };
}
