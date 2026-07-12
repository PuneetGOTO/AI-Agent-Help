import { Logger, LogLevel, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http/http-exception.filter';
import { requestIdMiddleware } from './common/http/request-id.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const logLevels: LogLevel[] = ['log', 'error', 'warn'];
  if (config.get('NODE_ENV') === 'development') logLevels.push('debug');
  app.useLogger(logLevels);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.enableCors({
    origin: config
      .getOrThrow<string>('WEB_URL')
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Organization-Id',
      'X-Workspace-Id',
      'X-Request-Id',
      'X-Bootstrap-Token',
    ],
    exposedHeaders: ['X-Request-Id'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Enterprise AI Agent Platform API')
    .setDescription('Multi-tenant management and execution API for enterprise AI agents')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'X-Workspace-Id' }, 'workspace')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swaggerConfig), {
    swaggerOptions: { persistAuthorization: true },
  });

  app.enableShutdownHooks();
  const port = config.get<number>('API_PORT', 4000);
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on http://localhost:${port}/api/v1`);
  logger.log(`Swagger available at http://localhost:${port}/docs`);
}

void bootstrap();
