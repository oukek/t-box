import type { ApplicationManifest } from '@t-box/app-contracts'
import type {
  CalculatorDefinition,
  CalculatorField,
  CalculatorKind,
  CalculatorOption,
} from './types.js'
import { CalculationErrorCode } from './error-codes.js'
import { applicationIcon } from './icon.js'

const choices = (items: [string, string][]): CalculatorOption[] =>
  items.map(([value, label]) => ({ value, label }))
const number = (
  key: string,
  label: string,
  value: string,
): CalculatorField => ({ key, label, type: 'number', default: value })
const select = (
  key: string,
  label: string,
  options: readonly CalculatorOption[],
): CalculatorField => ({
  key,
  label,
  type: 'select',
  default: options[0]!.value,
  options,
})
const text = (
  key: string,
  label: string,
  value: string,
  type: CalculatorField['type'] = 'text',
): CalculatorField => ({ key, label, type, default: value })
const expr = [
  text('expression', '公式', ''),
  select(
    'angle',
    '角度模式',
    choices([
      ['deg', 'DEG · 角度'],
      ['rad', 'RAD · 弧度'],
    ]),
  ),
  number('ans', '上次结果', '0'),
]
export const calculatorCatalog: readonly CalculatorDefinition[] = [
  {
    id: 'basic',
    title: '基础计算',
    group: '运算',
    description: '四则运算、括号与百分比',
    note: '百分号表示除以 100：200 × 10% = 20；200 + 10% = 200.1。',
    fields: expr,
  },
  {
    id: 'scientific',
    title: '科学计算',
    group: '运算',
    description: '三角函数、对数、幂与排列组合',
    note: '支持 sin/cos/tan、asin/acos/atan、sinh/cosh/tanh、ln/log/log2、sqrt/cbrt、exp/abs、floor/ceil/round、min/max/hypot、gcd/lcm、ncr/npr。log 为常用对数；^ 右结合；支持 π、e、ANS、阶乘和 mod。实数运算，约保留 15 位有效数字。',
    fields: expr,
  },
  {
    id: 'fraction',
    title: '分数运算',
    group: '运算',
    description: '精确约分、四则运算与带分数',
    note: '分子和分母为整数（最多 256 位），分母不能为 0。使用整数运算精确约分，小数展示最多 12 位。',
    fields: [
      text('a', '第一个分子', '1'),
      text('b', '第一个分母', '3'),
      select(
        'operation',
        '运算',
        choices([
          ['add', '相加 +'],
          ['subtract', '相减 −'],
          ['multiply', '相乘 ×'],
          ['divide', '相除 ÷'],
        ]),
      ),
      text('c', '第二个分子', '1'),
      text('d', '第二个分母', '6'),
    ],
  },
  {
    id: 'statistics',
    title: '数据统计',
    group: '分析',
    description: '均值、中位数、方差与标准差',
    note: '最多 1000 个数字，以空格、逗号、分号或换行分隔；同时展示总体与样本方差（样本至少 2 个）。',
    fields: [text('data', '数据列表', '1, 2, 3, 4, 5', 'textarea')],
  },
  {
    id: 'radix',
    title: '进制转换',
    group: '数论',
    description: '2 至 36 进制，支持大整数',
    note: '只支持整数（可带负号），不带 0x/0b 前缀；最多 256 位输入，使用大整数转换。字母 A 至 Z 表示 10 至 35。',
    fields: [
      text('value', '整数', '255'),
      number('from', '原进制（2 至 36）', '10'),
      number('to', '目标进制（2 至 36）', '16'),
    ],
  },
  {
    id: 'quadratic',
    title: '一元二次方程',
    group: '代数',
    description: 'ax² + bx + c = 0，含复数根',
    note: 'a = 0 时按一次方程处理；负判别式展示共轭复数根。使用稳定求根公式减少大数消减误差。',
    fields: [
      number('a', 'a', '1'),
      number('b', 'b', '-3'),
      number('c', 'c', '2'),
    ],
  },
  {
    id: 'linear',
    title: '二元一次方程',
    group: '代数',
    description: 'a₁x + b₁y = c₁；a₂x + b₂y = c₂',
    note: '系数按两行输入；对接近奇异的方程提示无法可靠求解。',
    fields: [
      number('a1', 'a₁', '1'),
      number('b1', 'b₁', '1'),
      number('c1', 'c₁', '3'),
      number('a2', 'a₂', '1'),
      number('b2', 'b₂', '-1'),
      number('c2', 'c₂', '1'),
    ],
  },
  {
    id: 'matrix',
    title: '矩阵运算',
    group: '代数',
    description: '乘法、转置、行列式与逆矩阵',
    note: '每行用空格或逗号分隔元素，换行或分号分隔行；每个矩阵最多 6 × 6。求逆与行列式需为方阵。',
    fields: [
      select(
        'operation',
        '运算',
        choices([
          ['multiply', 'A × B'],
          ['add', 'A + B'],
          ['subtract', 'A − B'],
          ['transpose', 'A 转置'],
          ['determinant', 'A 行列式'],
          ['inverse', 'A 的逆矩阵'],
        ]),
      ),
      text('a', '矩阵 A', '1 2\n3 4', 'textarea'),
      {
        ...text('b', '矩阵 B', '2 0\n0 2', 'textarea'),
        visible: {
          field: 'operation',
          values: ['multiply', 'add', 'subtract'],
        },
      },
    ],
  },
  {
    id: 'vector',
    title: '向量运算',
    group: '代数',
    description: '加减、点积、叉积、夹角与模长',
    note: '以空格或逗号分隔分量；向量维度需一致，最多 20 维。叉积仅支持三维，零向量没有夹角。',
    fields: [text('a', '向量 A', '1, 0, 0'), text('b', '向量 B', '0, 1, 0')],
  },
  {
    id: 'complex',
    title: '复数运算',
    group: '代数',
    description: '四则运算、模、辐角与共轭',
    note: '输入两个复数 a + bi 与 c + di；辐角以弧度和角度展示，零复数辐角无定义。',
    fields: [
      number('a', '第一个实部 a', '1'),
      number('b', '第一个虚部 b', '2'),
      select(
        'operation',
        '运算',
        choices([
          ['add', '相加 +'],
          ['subtract', '相减 −'],
          ['multiply', '相乘 ×'],
          ['divide', '相除 ÷'],
        ]),
      ),
      number('c', '第二个实部 c', '3'),
      number('d', '第二个虚部 d', '4'),
    ],
  },
  {
    id: 'combination',
    title: '排列与组合',
    group: '数论',
    description: 'n!、排列 P(n,r)、组合 C(n,r)',
    note: '要求 0 ≤ r ≤ n ≤ 1000，且为整数；使用大整数给出精确结果。',
    fields: [number('n', '总数 n', '10'), number('r', '选取数 r', '3')],
  },
  {
    id: 'sequence',
    title: '等差与等比数列',
    group: '代数',
    description: '第 n 项与前 n 项和',
    note: '等差数列填公差，等比数列填公比；项数为 1 至 10000 的整数。',
    fields: [
      select(
        'type',
        '数列类型',
        choices([
          ['arithmetic', '等差数列'],
          ['geometric', '等比数列'],
        ]),
      ),
      number('first', '首项 a₁', '1'),
      number('step', '公差 d / 公比 q', '2'),
      number('n', '项数 n', '10'),
    ],
  },
  {
    id: 'geometry',
    title: '几何计算',
    group: '几何',
    description: '面积、周长、体积与表面积',
    note: '各长度使用相同单位，面积和体积分别为该单位的平方和立方；只接受正数。三角形使用三边计算。',
    fields: [
      select(
        'shape',
        '形状',
        choices([
          ['circle', '圆'],
          ['rectangle', '矩形'],
          ['triangle', '三角形（三边）'],
          ['sphere', '球'],
          ['cylinder', '圆柱'],
          ['cuboid', '长方体'],
        ]),
      ),
      {
        ...number('radius', '半径', '3'),
        visible: { field: 'shape', values: ['circle', 'sphere', 'cylinder'] },
      },
      {
        ...number('length', '长度 / 边 a', '4'),
        visible: {
          field: 'shape',
          values: ['rectangle', 'triangle', 'cuboid'],
        },
      },
      {
        ...number('width', '宽度 / 边 b', '3'),
        visible: {
          field: 'shape',
          values: ['rectangle', 'triangle', 'cuboid'],
        },
      },
      {
        ...number('height', '高度 / 边 c', '5'),
        visible: { field: 'shape', values: ['triangle', 'cylinder', 'cuboid'] },
      },
    ],
  },
  {
    id: 'polynomial',
    title: '多项式计算',
    group: '分析',
    description: '求值、导数与定积分',
    note: '系数从最高次幂到常数项，例如 1, 0, −2 表示 x² − 2；最多 50 次。导数在 x 点计算，积分上下限可逆。',
    fields: [
      text('coefficients', '系数列表', '1, 0, -2'),
      number('x', '求值点 x', '2'),
      number('lower', '积分下限', '0'),
      number('upper', '积分上限', '2'),
    ],
  },
  {
    id: 'number_theory',
    title: '整数与数论',
    group: '数论',
    description: '质数判断、质因数分解与公约数',
    note: '输入 1 至 10¹² 的整数；质因数分解使用确定性试除法，结果精确。1 不是质数，没有质因数。',
    fields: [number('a', '整数 A', '360'), number('b', '整数 B', '48')],
  },
  {
    id: 'probability',
    title: '二项分布',
    group: '分析',
    description: '恰好 k 次、至多 k 次与期望',
    note: 'n 次独立伯努利试验，每次成功概率 p 相同。0 ≤ k ≤ n ≤ 10000，p 范围 0 至 1。累计概率为浮点数值近似。',
    fields: [
      number('n', '试验次数 n', '10'),
      number('k', '成功次数 k', '3'),
      number('p', '成功概率 p（0 至 1）', '0.5'),
    ],
  },
]
export const calculatorManifest = {
  id: 'calculator',
  name: '计算器',
  description: '科学运算、方程求解与数学分析。',
  icon: 'calculator',
  iconAsset: applicationIcon,
  color: 'blue',
  version: '1.1.1',
  skillIds: ['calculation'],
} as const satisfies ApplicationManifest
export function getCalculatorDefinition(id: string): CalculatorDefinition {
  const found = calculatorCatalog.find((c) => c.id === id)
  if (!found) {
    throw CalculationErrorCode.INVALID_CALCULATION('不支持此计算类型')
  }
  return found
}
export function parseCalculatorParams(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw CalculationErrorCode.INVALID_CALCULATION('计算器页面参数无效')
  }
  const args = value as Record<string, unknown>
  if (Object.keys(args).some((key) => !['kind', 'expression'].includes(key))) {
    throw CalculationErrorCode.INVALID_CALCULATION('计算器页面包含未知参数')
  }
  const result: Record<string, string> = {}
  if (args.kind != null) {
    if (typeof args.kind !== 'string') {
      throw CalculationErrorCode.INVALID_CALCULATION('计算类型无效')
    }
    result.kind = getCalculatorDefinition(args.kind).id
  }
  if (args.expression != null) {
    if (typeof args.expression !== 'string' || args.expression.length > 2000) {
      throw CalculationErrorCode.INVALID_CALCULATION('公式参数无效')
    }
    if (result.kind && !['basic', 'scientific'].includes(result.kind)) {
      throw CalculationErrorCode.INVALID_CALCULATION(
        '只有基础与科学计算支持公式参数',
      )
    }
    result.kind ||= 'scientific'
    result.expression = args.expression
  }
  return result
}
export function calculatorKind(value: string): CalculatorKind {
  return getCalculatorDefinition(value).id
}
