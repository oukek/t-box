<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from "vue";
import type {
  LedgerStatistics,
  StatisticPeriod,
  BillCategory,
} from "@t-box/ledger-contracts";
import DateSheetField from "@t-box/ui-kit/DateSheetField.vue";
import TrendChart from "@t-box/ui-kit/charts/TrendChart.vue";
import DonutChart from "@t-box/ui-kit/charts/DonutChart.vue";
import { trendPoints } from "@t-box/ui-kit/charts/data";
import { booksApi, type FinanceEvent } from "./booksApi";
import { bookState } from "./bookStore";
import {
  formatMoney,
  localDate,
  difference,
  toCents,
  fromCents,
} from "../bills/format";
const props = defineProps<{ ledgerId: string; debtEnabled: boolean }>(),
  period = ref<StatisticPeriod>("month"),
  value = ref(localDate().slice(0, 7)),
  stats = ref<LedgerStatistics>(),
  categories = ref<BillCategory[]>([]),
  error = ref(""),
  loading = ref(false),
  events = ref<FinanceEvent[]>([]),
  detailStart = ref(""),
  detailEnd = ref(""),
  page = ref(1),
  total = ref(0),
  detailsLoading = ref(false),
  detailError = ref("");
let controller: AbortController | undefined,
  detailGeneration = 0;
const periods: { id: StatisticPeriod; label: string }[] = [
  { id: "day", label: "日" },
  { id: "month", label: "月" },
  { id: "quarter", label: "季度" },
  { id: "year", label: "年" },
];
const labels: Record<string, string> = {
  income: "收入",
  expense: "支出",
  lend: "借出 / 应收建立",
  borrow: "借入 / 应付建立",
  collect: "收款",
  repay: "还款",
  correction: "修正记录",
  refund: "退款",
  transfer: "账户转账",
  writeoff: "减免 / 核销",
  reimbursement: "报销",
};
const hasOrdinary = computed(
  () =>
    !props.debtEnabled ||
    (!!stats.value &&
      (toCents(stats.value.income) > 0n ||
        toCents(stats.value.expense) !== 0n)),
);
const chart = computed(() =>
  trendPoints(
    stats.value?.series || [],
    period.value,
    hasOrdinary.value ? "ordinary" : "cash",
  ),
);
const categoryType = ref<"expense" | "income">("expense");
const distribution = computed(() =>
  (stats.value?.categories || [])
    .filter((row) => row.type === categoryType.value)
    .map((row) => ({
      ...row,
      label:
        categories.value.find((category) => category.id === row.category)
          ?.label || "历史分类",
    })),
);
const categoryTotal = computed(() =>
  fromCents(
    distribution.value.reduce((sum, row) => sum + toCents(row.amount), 0n),
  ),
);
function selectPeriod(next: StatisticPeriod) {
  period.value = next;
  const today = localDate();
  value.value =
    next === "day"
      ? today
      : next === "month"
        ? today.slice(0, 7)
        : next === "year"
          ? today.slice(0, 4)
          : `${today.slice(0, 4)}-Q${Math.ceil(Number(today.slice(5, 7)) / 3)}`;
}
async function load() {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  loading.value = true;
  error.value = "";
  try {
    const [a, b] = await Promise.all([
      booksApi.statistics(
        props.ledgerId,
        period.value,
        value.value,
        current.signal,
      ),
      booksApi.categories(props.ledgerId, current.signal),
    ]);
    if (current.signal.aborted) return;
    stats.value = a.data;
    categories.value = b.data;
    detailStart.value = a.data.start;
    detailEnd.value = a.data.end;
    page.value = 1;
    void loadDetails();
  } catch (cause) {
    if (!current.signal.aborted)
      error.value = cause instanceof Error ? cause.message : "统计加载失败";
  } finally {
    if (!current.signal.aborted) loading.value = false;
  }
}
async function loadDetails() {
  const generation = ++detailGeneration;
  detailsLoading.value = true;
  detailError.value = "";
  try {
    const result = await booksApi.events(
      props.ledgerId,
      detailStart.value,
      detailEnd.value,
      page.value,
    );
    if (generation !== detailGeneration) return;
    events.value = result.data;
    total.value = result.meta.total;
  } catch (cause) {
    if (generation === detailGeneration)
      detailError.value =
        cause instanceof Error ? cause.message : "明细加载失败";
  } finally {
    if (generation === detailGeneration) detailsLoading.value = false;
  }
}
function drill(start: string, end: string) {
  page.value = 1;
  detailStart.value = start;
  detailEnd.value = end;
  void loadDetails();
}
function allDetails() {
  if (stats.value) {
    detailStart.value = stats.value.start;
    detailEnd.value = stats.value.end;
    page.value = 1;
    void loadDetails();
  }
}
watch([period, value, () => props.ledgerId, () => bookState.revision], load, {
  immediate: true,
});
onBeforeUnmount(() => {
  controller?.abort();
  detailGeneration++;
});
</script>
<template>
  <section class="statistics-panel">
    <header class="statistics-toolbar">
      <h2 class="sr-only">账本统计</h2>
      <DateSheetField
        v-model="value"
        :mode="period === 'day' ? 'date' : period"
        label="选择统计期间"
        compact
      />
      <div class="segmented-control" role="group" aria-label="统计周期">
        <button
          v-for="item in periods"
          :key="item.id"
          :class="{ active: period === item.id }"
          :aria-pressed="period === item.id"
          @click="selectPeriod(item.id)"
        >
          {{ item.label }}
        </button>
      </div>
    </header>
    <p v-if="error" class="form-error" role="alert">
      {{ error }}<button class="text-button" @click="load">重试</button>
    </p>
    <p v-if="loading" class="statistics-loading" role="status">正在汇总…</p>
    <template v-else-if="stats && !error">
      <section class="statistics-card statistics-overview">
        <div class="statistics-range">
          {{ stats.start }} — {{ stats.end
          }}<span>{{
            hasOrdinary ? `${stats.count} 笔收支` : "资金流汇总"
          }}</span>
        </div>
        <div class="statistics-totals">
          <article>
            <span>{{ hasOrdinary ? "期间收入" : "资金流入" }}</span
            ><strong class="income">{{
              formatMoney(hasOrdinary ? stats.income : stats.cashIn)
            }}</strong>
          </article>
          <article>
            <span>{{ hasOrdinary ? "净支出" : "资金流出" }}</span
            ><strong>{{
              formatMoney(hasOrdinary ? stats.expense : stats.cashOut)
            }}</strong>
          </article>
          <article class="statistics-balance">
            <span>{{ hasOrdinary ? "收支结余" : "资金净流入" }}</span
            ><strong>{{
              formatMoney(hasOrdinary ? stats.balance : stats.cashNet)
            }}</strong>
          </article>
        </div>
        <span class="statistics-unit"
          >单位：人民币元 ·
          {{ hasOrdinary ? "不含借还本金" : "借还本金计入资金流" }}</span
        >
      </section>
      <p
        v-if="
          hasOrdinary && (Number(stats.refunded) || Number(stats.reimbursed))
        "
        class="feature-hint"
      >
        原始支出 {{ stats.grossExpense }} 元 · 本期退款 {{ stats.refunded }} 元
        · 报销到账
        {{ stats.reimbursed }}
        元。按实际到账日期抵减净支出，跨期到账可能使本期净支出为负。
      </p>
      <div
        v-if="debtEnabled || Number(stats.currentReceivable)"
        class="statistics-card debt-statistics"
      >
        <div class="statistics-debt-balances">
          <article>
            <span>当前剩余应收</span
            ><strong class="income"
              >¥ {{ formatMoney(stats.currentReceivable) }}</strong
            ><small>截至今天 · 含往来与待报销</small>
          </article>
          <article>
            <span>当前剩余应付</span
            ><strong>¥ {{ formatMoney(stats.currentPayable) }}</strong
            ><small>截至今天 · 账本欠别人</small>
          </article>
        </div>
        <div class="table-scroll">
          <table class="book-table">
            <caption>
              所选期间的往来余额
            </caption>
            <thead>
              <tr>
                <th>方向</th>
                <th>期初</th>
                <th>期末</th>
                <th>期间变动</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>应收</th>
                <td>{{ formatMoney(stats.openingReceivable) }}</td>
                <td>{{ formatMoney(stats.closingReceivable) }}</td>
                <td>
                  {{
                    formatMoney(
                      difference(
                        stats.closingReceivable,
                        stats.openingReceivable,
                      ),
                    )
                  }}
                </td>
              </tr>
              <tr>
                <th>应付</th>
                <td>{{ formatMoney(stats.openingPayable) }}</td>
                <td>{{ formatMoney(stats.closingPayable) }}</td>
                <td>
                  {{
                    formatMoney(
                      difference(stats.closingPayable, stats.openingPayable),
                    )
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="statistics-charts" :class="{ single: !hasOrdinary }">
        <section class="statistics-card">
          <header class="statistics-card-heading">
            <h3>{{ hasOrdinary ? "收支趋势" : "资金流趋势" }}</h3>
            <small>{{
              period === "year"
                ? "按月"
                : period === "quarter"
                  ? "每 7 天"
                  : "按日"
            }}</small>
          </header>
          <TrendChart
            :points="chart"
            :income-label="hasOrdinary ? '收入' : '流入'"
            :expense-label="hasOrdinary ? '支出' : '流出'"
            @select="drill"
          />
        </section>
        <section v-if="hasOrdinary" class="statistics-card">
          <header class="statistics-card-heading">
            <h3>分类占比</h3>
            <div
              class="segmented-control"
              role="group"
              aria-label="分类占比类型"
            >
              <button
                :class="{ active: categoryType === 'expense' }"
                :aria-pressed="categoryType === 'expense'"
                @click="categoryType = 'expense'"
              >
                支出</button
              ><button
                :class="{ active: categoryType === 'income' }"
                :aria-pressed="categoryType === 'income'"
                @click="categoryType = 'income'"
              >
                收入
              </button>
            </div>
          </header>
          <div class="category-total-heading">
            <span>{{ categoryType === "expense" ? "支出" : "收入" }}合计</span
            ><strong>¥ {{ formatMoney(categoryTotal) }}</strong>
          </div>
          <DonutChart
            :rows="distribution.filter((row) => Number(row.amount) > 0)"
            :label="categoryType === 'expense' ? '支出' : '收入'"
          />
          <p
            v-if="distribution.some((row) => Number(row.amount) < 0)"
            class="feature-hint"
          >
            饼图仅展示正净额；负净额退款分类：{{
              distribution
                .filter((row) => Number(row.amount) < 0)
                .map((row) => row.label + " " + row.amount + " 元")
                .join("、")
            }}。
          </p>
        </section>
      </div>
      <details v-if="hasOrdinary" class="statistics-card statistics-cash">
        <summary>
          <span>资金流</span><small>净流入</small
          ><strong>¥ {{ formatMoney(stats.cashNet) }}</strong>
        </summary>
        <div class="cash-flow-values">
          <span
            >流入<strong>¥ {{ formatMoney(stats.cashIn) }}</strong></span
          ><span
            >流出<strong>¥ {{ formatMoney(stats.cashOut) }}</strong></span
          >
        </div>
        <p class="muted">
          借还本金计入资金流，不计入普通收支；补录往来不产生资金流。
        </p>
      </details>
      <section class="statistics-card statistics-details">
        <header class="book-section-heading">
          <div>
            <h3>统计明细</h3>
            <small
              >{{ detailStart }} 至 {{ detailEnd }} · {{ total }} 条事件</small
            >
          </div>
          <button class="text-button" @click="allDetails">查看整个期间</button>
        </header>
        <p v-if="detailError" class="form-error" role="alert">
          {{ detailError }}
        </p>
        <p v-else-if="detailsLoading">正在读取明细…</p>
        <div v-else>
          <article v-for="event in events" :key="event.id" class="event-row">
            <div>
              <b>{{ labels[event.kind] || event.kind }}</b
              ><time>{{ event.date }}</time>
              <p>{{ event.note || "无备注" }}</p>
            </div>
            <div class="event-amounts">
              <span v-if="Number(event.income)"
                >收入 {{ formatMoney(event.income) }}</span
              ><span v-if="Number(event.expense)"
                >支出 {{ formatMoney(event.expense) }}</span
              ><span v-if="Number(event.inflow)"
                >流入 {{ formatMoney(event.inflow) }}</span
              ><span v-if="Number(event.outflow)"
                >流出 {{ formatMoney(event.outflow) }}</span
              ><span v-if="Number(event.receivableChange)"
                >应收变动 {{ formatMoney(event.receivableChange) }}</span
              ><span v-if="Number(event.payableChange)"
                >应付变动 {{ formatMoney(event.payableChange) }}</span
              >
            </div>
          </article>
          <p v-if="!events.length" class="muted">这个期间没有记录。</p>
        </div>
        <footer v-if="total > 20" class="pagination">
          <span>第 {{ page }} / {{ Math.ceil(total / 20) }} 页</span>
          <div>
            <button
              class="button button-secondary"
              :disabled="page === 1 || detailsLoading"
              @click="
                page--;
                loadDetails();
              "
            >
              上一页</button
            ><button
              class="button button-secondary"
              :disabled="page * 20 >= total || detailsLoading"
              @click="
                page++;
                loadDetails();
              "
            >
              下一页
            </button>
          </div>
        </footer>
        <p class="muted stats-footnote">
          修改或撤销以原发生日期修正统计；明细保留原始记录和修正记录。
        </p>
      </section>
    </template>
  </section>
</template>
