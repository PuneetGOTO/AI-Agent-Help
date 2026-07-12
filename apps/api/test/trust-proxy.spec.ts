import { ExpressAdapter } from '@nestjs/platform-express';
import type { Express, Request, Response } from 'express';
import request from 'supertest';

function createIpProbe(trustProxyHops: number) {
  const app = new ExpressAdapter().getInstance<Express>();
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);
  app.get('/ip', (req: Request, res: Response) => res.json({ ip: req.ip }));
  return app;
}

describe('trusted proxy configuration', () => {
  it('does not trust a spoofed forwarded address when disabled', async () => {
    const response = await request(createIpProbe(0))
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.10');

    expect(response.body.ip).not.toBe('203.0.113.10');
  });

  it('uses the first forwarded address only when one proxy hop is configured', async () => {
    const response = await request(createIpProbe(1))
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.10');

    expect(response.body.ip).toBe('203.0.113.10');
  });
});
