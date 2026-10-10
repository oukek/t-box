/* eslint-disable import/no-duplicates -- Bare plugin imports keep module augmentations in emitted declarations. */
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'
import dayOfYear from 'dayjs/plugin/dayOfYear.js'
import isLeapYear from 'dayjs/plugin/isLeapYear.js'
import isoWeek from 'dayjs/plugin/isoWeek.js'
import timezone from 'dayjs/plugin/timezone.js'
import utc from 'dayjs/plugin/utc.js'
import 'dayjs/plugin/utc.js'
import 'dayjs/plugin/timezone.js'
import 'dayjs/plugin/customParseFormat.js'
import 'dayjs/plugin/isoWeek.js'
import 'dayjs/plugin/dayOfYear.js'
import 'dayjs/plugin/isLeapYear.js'
/* eslint-enable import/no-duplicates */
import 'dayjs/locale/zh-cn.js'

// One configuration for browsers and Node; no custom date arithmetic engine.
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)
dayjs.extend(isoWeek)
dayjs.extend(dayOfYear)
dayjs.extend(isLeapYear)
dayjs.locale('zh-cn')
export { dayjs }
export type { Dayjs, ManipulateType } from 'dayjs'
