export interface AppUser {
  id: string
  username: string
  nickname: string
  createdAt: string
}
export interface UserSession {
  token: string
  user: AppUser
}
