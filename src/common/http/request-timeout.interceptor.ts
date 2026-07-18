import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import {
  catchError,
  Observable,
  throwError,
  timeout,
  TimeoutError,
} from 'rxjs';

@Injectable()
export class RequestTimeoutInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const timeoutMs = parsePositiveInteger(
      process.env.REQUEST_TIMEOUT_MS,
      60_000,
    );

    return next.handle().pipe(
      timeout(timeoutMs),
      catchError((error: unknown) =>
        error instanceof TimeoutError
          ? throwError(
              () =>
                new RequestTimeoutException({
                  code: 'REQUEST_TIMEOUT',
                  timeoutMs,
                }),
            )
          : throwError(() => error),
      ),
    );
  }
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
