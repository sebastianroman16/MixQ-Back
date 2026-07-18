import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const requestId = response.getHeader('X-Request-Id');
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      const error = exception instanceof Error ? exception : undefined;
      this.logger.error(
        JSON.stringify({
          event: 'request_error',
          requestId,
          method: request.method,
          path: request.path,
          status,
          error: error?.name ?? 'UnknownError',
          message: error?.message ?? 'Unknown error',
        }),
        error?.stack,
      );
    }

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response
        .status(status)
        .json(
          typeof body === 'string'
            ? { statusCode: status, message: body, requestId }
            : { ...(body as Record<string, unknown>), requestId },
        );
      return;
    }

    response.status(status).json({
      statusCode: status,
      message: 'Internal server error',
      requestId,
    });
  }
}
