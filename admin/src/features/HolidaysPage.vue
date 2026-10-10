<script setup lang="ts">
import type {
  HolidayDataset,
  HolidaySyncSettings,
  HolidayYearAdmin,
} from '@t-box/calendar-contracts'
import { onMounted, ref } from 'vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminSelect from '../components/AdminSelect.vue'
import { errorMessage, request, save } from '../core/api'

const years = ref<HolidayYearAdmin[]>([])
const settings = ref<HolidaySyncSettings>({ enabled: true, autoPublish: true })
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const formError = ref('')
const dialog = ref<
  'sync' | 'edit' | 'publish' | 'automatic' | 'settings' | 'audit' | null
>(null)
const selected = ref<HolidayYearAdmin | null>(null)
const year = ref(new Date().getFullYear())
const draft = ref<HolidayDataset>({ year: year.value, papers: [], days: [] })
const config = ref<HolidaySyncSettings>({ ...settings.value })
const audits = ref<
  {
    id: string
    action: string
    actorId: string | null
    revision: number
    createdAt: string
  }[]
>([])
const actionLabels: Record<string, string> = {
  sync: '自动同步',
  auto_publish: '自动发布',
  draft: '保存草稿',
  publish: '人工发布',
  automatic: '恢复自动更新',
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await request<{
      years: HolidayYearAdmin[]
      settings: HolidaySyncSettings
    }>('/calendar/holidays')
    years.value = result.years
    settings.value = result.settings
  } catch (cause) {
    error.value = errorMessage(cause)
  } finally {
    loading.value = false
  }
}
function open(
  mode: NonNullable<typeof dialog.value>,
  row: HolidayYearAdmin | null = null,
) {
  selected.value = row
  formError.value = ''
  if (row) {
    year.value = row.year
    const data = row.candidate ?? row.data
    draft.value = {
      year: row.year,
      papers: [...(data?.papers ?? [])],
      days: (data?.days ?? []).map((day) => ({ ...day })),
    }
  }
  config.value = {
    enabled: settings.value.enabled,
    autoPublish: settings.value.autoPublish,
  }
  dialog.value = mode
}
async function history(row: HolidayYearAdmin) {
  open('audit', row)
  busy.value = true
  audits.value = []
  try {
    audits.value = await request(`/calendar/holiday-years/${row.year}/audit`)
  } catch (cause) {
    formError.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}
async function submit() {
  if (busy.value || !dialog.value) {
    return
  }
  busy.value = true
  formError.value = ''
  try {
    if (dialog.value === 'settings') {
      await save('/calendar/holiday-settings', config.value, 'PATCH')
    } else if (dialog.value === 'sync') {
      const result = await save<HolidayYearAdmin>(
        `/calendar/holiday-years/${year.value}/sync`,
        {},
      )
      if (result.lastError) {
        await load()
        formError.value = result.lastError
        return
      }
    } else if (selected.value) {
      const path = `/calendar/holiday-years/${selected.value.year}`
      if (dialog.value === 'edit') {
        await save(
          `${path}/draft`,
          { revision: selected.value.revision, data: draft.value },
          'PUT',
        )
      } else {
        await save(`${path}/${dialog.value}`, {
          revision: selected.value.revision,
        })
      }
    }
    dialog.value = null
    await load()
  } catch (cause) {
    formError.value = errorMessage(cause)
  } finally {
    busy.value = false
  }
}
onMounted(load)
</script>

<template>
  <header class="page-heading">
    <div>
      <p class="eyebrow">CALENDAR DATA</p>
      <h1>节假日管理</h1>
      <p>管理中国大陆年度放假、调休安排。发布后网页与 App 自动获取。</p>
    </div>
    <div class="actions">
      <button class="primary" @click="open('sync')">同步年度</button><button @click="open('settings')">同步配置</button><button :disabled="loading" @click="load">刷新</button>
    </div>
  </header>
  <p
    v-if="error"
    class="alert"
    role="alert"
  >
    {{ error }}
  </p>
  <section class="panel">
    <div class="panel-heading">
      <h2>年度安排</h2>
      <span class="badge">{{ settings.enabled ? "自动同步已开启" : "自动同步已关闭" }} ·
        {{ settings.autoPublish ? "校验通过后自动发布" : "人工审核发布" }}</span>
    </div>
    <p class="holiday-description">
      数据源：<a
        href="https://github.com/NateScarlet/holiday-cn"
        target="_blank"
        rel="noopener noreferrer"
      >holiday-cn</a>（根据国务院公告整理）。每个年度保留官方原文链接；同步失败和未公布年度不会覆盖已发布安排。
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>年度</th>
            <th>发布状态</th>
            <th>更新方式</th>
            <th>最近检查</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in years" :key="row.year">
            <td>
              <strong>{{ row.year }}</strong><small>{{ row.data?.days.length ?? 0 }} 条已发布日期 · v{{
                row.revision
              }}</small>
            </td>
            <td>
              <span class="badge" :class="{ disabled: !row.data }">{{
                row.data ? "已发布" : "尚未发布"
              }}</span><small v-if="row.lastError" class="sync-error">{{
                row.lastError
              }}</small><small
                v-else-if="
                  row.candidate
                    && JSON.stringify(row.candidate) !== JSON.stringify(row.data)
                "
              >有待发布变更</small>
            </td>
            <td>{{ row.manual ? "手动保护" : "自动更新" }}</td>
            <td>
              {{
                row.checkedAt
                  ? new Date(row.checkedAt).toLocaleString("zh-CN")
                  : "尚未检查"
              }}
            </td>
            <td>
              <div class="actions">
                <button @click="open('edit', row)">查看 / 编辑</button><button
                  :disabled="!row.candidate"
                  @click="open('publish', row)"
                > 发布候选</button><button v-if="row.manual" @click="open('automatic', row)"> 恢复自动</button><button @click="history(row)">记录</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="loading" class="empty">正在读取…</p>
    <p v-else-if="!years.length" class="empty">
      尚无年度数据，点击“同步年度”获取。
    </p>
  </section>
  <AdminDialog
    :open="dialog !== null"
    :title="
      (
        {
          sync: '同步年度',
          edit: `${selected?.year} 年候选数据`,
          publish: '发布年度安排',
          automatic: '恢复自动更新',
          settings: '同步配置',
          audit: '变更记录',
        } as const
      )[dialog ?? 'sync']
    "
    :busy="busy"
    @close="dialog = null"
  >
    <p
      v-if="formError"
      class="alert"
      role="alert"
    >
      {{ formError }}
    </p>
    <form
      v-if="dialog !== 'audit'"
      id="holiday-form"
      @submit.prevent="submit"
    >
      <fieldset :disabled="busy">
        <template v-if="dialog === 'sync'">
          <label>年度<input
            v-model.number="year"
            type="number"
            min="1900"
            max="2100"
            required
          ></label>
          <p class="muted">
            将获取对应年度的公告数据。未公布、未收录或网络失败时保留原数据。手动保护的年度不会被覆盖。
          </p>
        </template>
        <template v-else-if="dialog === 'settings'">
          <label class="holiday-check"><input
            v-model="config.enabled"
            type="checkbox"
          >开启后端定期同步</label><label class="holiday-check"><input
            v-model="config.autoPublish"
            type="checkbox"
          >校验通过后自动发布</label>
          <p class="muted">
            启动后检查上一年、本年和下一年，每日最多自动更新一次。关闭自动发布后，新数据进入候选，待管理员发布。
          </p>
        </template>
        <template v-else-if="dialog === 'edit'">
          <p class="muted">
            保存后进入候选并开启手动保护；“发布候选”后才会影响用户。
          </p>
          <label
            v-for="(source, index) in draft.papers"
            :key="index"
            :title="source"
          >官方原文 {{ index + 1 }}
            <div class="holiday-source">
              <input
                v-model="draft.papers[index]"
                type="url"
                required
                placeholder="国务院或政府网站公告网址"
              ><button type="button" @click="draft.papers.splice(index, 1)">
                移除
              </button>
            </div></label>
          <button type="button" @click="draft.papers.push('')">
            添加官方原文
          </button>
          <div class="holiday-edit-heading">
            <strong>{{ draft.days.length }} 条日期</strong><button
              type="button"
              :disabled="draft.days.length >= 120"
              @click="
                draft.days.push({
                  date: `${draft.year}-01-01`,
                  name: '',
                  status: 'rest',
                })
              "
            >
              新增日期
            </button>
          </div>
          <div
            v-for="(day, index) in draft.days"
            :key="index"
            class="holiday-edit-day"
          >
            <label>日期<input
              v-model="day.date"
              type="date"
              required
              :aria-label="`第 ${index + 1} 条日期`"
            ></label>
            <label>节日<input
              v-model="day.name"
              maxlength="50"
              required
              :aria-label="`第 ${index + 1} 条节日名称`"
            ></label>
            <label>安排<AdminSelect
              v-model="day.status"
              :options="[
                { value: 'rest', label: '放假' },
                { value: 'work', label: '调休上班' },
              ]"
              :label="`第 ${index + 1} 条安排`"
            /></label>
            <button
              type="button"
              class="holiday-remove"
              :aria-label="`删除第 ${index + 1} 条日期`"
              @click="draft.days.splice(index, 1)"
            >
              删除
            </button>
          </div>
        </template>
        <p v-else-if="dialog === 'publish'">
          发布 {{ selected?.year }} 年候选数据？发布后立即供前端和 AI
          使用，并开启手动保护，自动同步不会覆盖。
        </p>
        <p v-else-if="dialog === 'automatic'">
          恢复
          {{ selected?.year }}
          年自动更新？下一次同步可替换手动候选；开启自动发布时也会更新已发布安排。
        </p>
      </fieldset>
    </form>
    <ul v-else class="holiday-audits">
      <li v-for="item in audits" :key="item.id">
        <strong>{{ actionLabels[item.action] ?? item.action }} · v{{
          item.revision
        }}</strong><span>{{ new Date(item.createdAt).toLocaleString("zh-CN") }} ·
          {{ item.actorId ? "管理员操作" : "系统任务" }}</span>
      </li>
      <li v-if="!audits.length">暂无记录</li>
    </ul>
    <template #footer>
      <button :disabled="busy" @click="dialog = null">
        {{ dialog === "audit" ? "关闭" : "取消" }}
      </button><button
        v-if="dialog !== 'audit'"
        class="primary"
        form="holiday-form"
        type="submit"
        :disabled="busy"
      >
        {{ busy ? "正在处理…" : dialog === "edit" ? "保存草稿" : "确认" }}
      </button>
    </template>
  </AdminDialog>
</template>

<style scoped>
.holiday-description {
  margin: 0;
  padding: 16px 22px;
  color: #7b8982;
  font-size: 12px;
  line-height: 1.8;
}
td small {
  display: block;
  margin-top: 6px;
  max-width: 280px;
  color: #829087;
  font-size: 11px;
}
td .sync-error {
  color: #ab7959;
}
.holiday-check {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin: 16px 0;
}
.holiday-check input {
  width: auto;
}
.holiday-json {
  width: 100%;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
  min-height: 320px;
}
.holiday-audits {
  list-style: none;
  margin: 0;
  padding: 0;
}
.holiday-audits li {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 14px 0;
  border-bottom: 1px solid #e8ece9;
}
.holiday-audits span {
  color: #87968e;
  font-size: 12px;
}
</style>

<style scoped>
.holiday-source {
  display: flex;
  gap: 8px;
  align-items: center;
}
.holiday-edit-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 20px 0 12px;
}
.holiday-edit-day {
  display: grid;
  grid-template-columns: 145px minmax(90px, 1fr) 125px auto;
  gap: 8px;
  align-items: end;
  padding: 12px 0;
  border-top: 1px solid #edf0ee;
}
.holiday-edit-day label {
  margin: 0;
  font-size: 11px;
}
.holiday-remove {
  margin-bottom: 1px;
}
@media (max-width: 600px) {
  .holiday-edit-day {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
