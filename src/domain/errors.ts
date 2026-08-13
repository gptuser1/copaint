// 统一应用错误：携带 HTTP 状态码，路由层通过 Hono onError 映射为响应
// 纯领域定义，不依赖 worker / Hono

export class AppError extends Error {
  constructor(
    message: string,
    public status: number = 500,
    public code: string = 'APP_ERROR',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'resource not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'invalid request') {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

// 必需配置缺失（配置只从数据源读取，未配置即报错，无兜底）
export class ConfigMissingError extends AppError {
  constructor(key: string) {
    super(`config not set: ${key}`, 503, 'CONFIG_MISSING');
    this.name = 'ConfigMissingError';
  }
}
