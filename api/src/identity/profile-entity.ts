import { EntitySchema } from 'typeorm'

export interface UserProfileRow {
  userId: string
  avatarUrl: string
  avatarResourceId: string | null
}
export const UserProfileEntity = new EntitySchema<UserProfileRow>({
  name: 'UserProfile',
  tableName: 'app_user_profiles',
  columns: {
    userId: { type: 'char', length: 36, name: 'user_id', primary: true },
    avatarUrl: { type: 'varchar', length: 2048, name: 'avatar_url', default: '' },
    avatarResourceId: { type: 'char', length: 36, name: 'avatar_resource_id', nullable: true },
  },
})
export const userProfileExtension = {
  id: '2026-10-28-user-profiles',
  tables: [`CREATE TABLE app_user_profiles (
    user_id char(36) NOT NULL PRIMARY KEY,
    avatar_url varchar(2048) NOT NULL DEFAULT '',
    avatar_resource_id char(36) DEFAULT NULL,
    CONSTRAINT app_profile_user_fk FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE,
    CONSTRAINT app_profile_avatar_fk FOREIGN KEY(avatar_resource_id) REFERENCES resources(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
}
