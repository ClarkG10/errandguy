import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import * as express from 'express';
import { AppModule } from './app.module';
import { buildValidationPipe } from './common/pipes/validation-pipe.factory';
import { AllExceptionsFilter } from './common/exceptions/all-exceptions.filter';
import { CacheControlInterceptor } from './common/interceptors/cache-control.interceptor';
import { LogRequestsInterceptor } from './common/interceptors/log-requests.interceptor';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { PrismaService } from './prisma/prisma.service';
import type { AppConfig, LimitsConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const appCfg = config.get<AppConfig>('app')!;
  const limits = config.get<LimitsConfig>('limits')!;

  // Body parsing with the JSON byte cap (LimitRequestSize). Oversize →
  // entity.too.large (mapped to 413), malformed → entity.parse.failed (→ 400).
  app.use(express.json({ limit: limits.maxBodyBytes }));
  app.use(express.urlencoded({ extended: true, limit: limits.maxBodyBytes }));

  app.setGlobalPrefix(appCfg.apiPrefix);
  (app.getHttpAdapter().getInstance() as express.Application).set('trust proxy', true);

  app.enableCors({
    origin: limits.corsOrigins.length ? limits.corsOrigins : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Accept',
      'Authorization',
      'Content-Type',
      'X-Requested-With',
      'X-CSRF-TOKEN',
      'X-XSRF-TOKEN',
      'X-Socket-Id',
      'Idempotency-Key',
    ],
    credentials: false,
    maxAge: 600,
  });

  const reflector = app.get(Reflector);
  const prisma = app.get(PrismaService);

  app.useGlobalPipes(buildValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  // Order: log (outermost) → cache-control → idempotency (innermost, closest to handler).
  app.useGlobalInterceptors(
    new LogRequestsInterceptor(),
    new CacheControlInterceptor(),
    new IdempotencyInterceptor(reflector, prisma),
  );

  app.enableShutdownHooks();

  await app.listen(appCfg.port);
  new Logger('Bootstrap').log(
    `ErrandGuy API (NestJS) listening on :${appCfg.port} at /${appCfg.apiPrefix}`,
  );
}

void bootstrap();
