# CRM 数据库迁移指南

## 迁移步骤

### 1. 应用表结构迁移

在 Cloudflare D1 数据库中执行：

```bash
# 创建 CRM 表
wrangler d1 execute <your-database-name> --file=migrations/002_crm_tables.sql

# 验证表创建
wrangler d1 execute <your-database-name> --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vehicle_crm%'"
```

### 2. 数据迁移（可选）

如果您有现有的申请数据，可以迁移到 CRM 系统：

```bash
wrangler d1 execute <your-database-name> --file=migrations/003_crm_data_migration.sql
```

**注意**：
- 此步骤是可选的
- 仅在有历史数据需要迁移时执行
- 迁移脚本会从 `application` 表提取车辆、关系人、时间轴数据

### 3. 部署 API

```bash
# 部署到 Cloudflare Workers
wrangler deploy
```

### 4. 验证 API

测试健康检查：
```bash
curl -I https://your-api.workers.dev/api/health
# 应返回 200 OK
```

测试车辆查询：
```bash
curl https://your-api.workers.dev/api/crm/vehicles?q=粤B
```

## API 端点列表

### 基础功能
- `HEAD /api/health` - 健康检查（前端用于检测后端可用性）

### 车辆查询
- `GET /api/crm/vehicle/:plateOrVin` - 按车牌或VIN查询车辆档案
- `GET /api/crm/vehicles?q=xxx` - 搜索车辆

### 客户管理
- `GET /api/crm/customers?q=xxx` - 搜索客户

### 时间轴
- `GET /api/crm/vehicle/:profileId/timeline` - 获取车辆时间轴

### 沟通记录
- `GET /api/crm/vehicle/:profileId/interactions` - 获取沟通记录
- `POST /api/crm/interactions` - 添加沟通记录

### 风险标记
- `GET /api/crm/vehicle/:profileId/flags` - 获取风险标记
- `POST /api/crm/flags` - 添加风险标记

## 前端自动切换

前端 `crmDataSource.ts` 会自动检测：
1. 尝试访问 `/api/health`
2. 成功 → 使用数据库模式
3. 失败 → 降级到 localStorage 模式

无需手动配置！
