import { defineApiErrors } from '@t-box/errors'

export const BabyErrorCode = defineApiErrors({
  BABY_CARE_NOT_FOUND: { statusCode: 404, message: '照护记录不存在或已删除' },
  BABY_CARE_ACTIVE: { statusCode: 409, message: '家人已启动同类计时，请查看进行中的记录' },
  BABY_CARE_RANGE: { statusCode: 400, message: '记录过多，请缩小查询日期范围' },
  BABY_INSTALLATION_CHANGED: {
    statusCode: 409,
    message: '应用安装状态已改变，请重新打开宝宝日记',
  },
  BABY_INVALID_INPUT: { statusCode: 400, message: '请检查填写内容' },
  BABY_NOT_FOUND: {
    statusCode: 404,
    message: '宝宝档案不存在或你没有访问权限',
  },
  BABY_FORBIDDEN: { statusCode: 403, message: '你没有此项操作权限' },
  BABY_CONFLICT: {
    statusCode: 409,
    message: '内容已被其他成员修改，请刷新后重试',
  },
  BABY_ARCHIVED: { statusCode: 409, message: '档案已归档，请先恢复档案' },
  BABY_INVITE_INVALID: {
    statusCode: 410,
    message: '邀请已失效、已撤销或已达到使用次数',
  },
  BABY_OWNER_REQUIRED: {
    statusCode: 403,
    message: '只有档案所有者可以进行此操作',
  },
  BABY_RECORD_NOT_FOUND: { statusCode: 404, message: '记录不存在或已删除' },
  BABY_PROJECT_NOT_FOUND: {
    statusCode: 404,
    message: '创意项目不存在或已删除',
  },
  BABY_MEMBER_INVALID: {
    statusCode: 409,
    message: '不能修改所有者；所有者需先转让档案再退出',
  },
  BABY_BATCH_LIMIT: { statusCode: 400, message: '每次最多批量添加 30 条记录' },
  BABY_FRAME_LIMIT: {
    statusCode: 400,
    message: '每个创意项目最多保存 1000 帧照片',
  },
})
