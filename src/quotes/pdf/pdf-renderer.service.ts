import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';
import { isAllowedRemoteAssetUrl } from '../../common/security/remote-asset-url';

@Injectable()
export class PdfRendererService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRendererService.name);
  private readonly maxConcurrentRenders = Math.max(
    1,
    Number(process.env.PDF_RENDER_CONCURRENCY ?? 2),
  );
  private browserPromise: Promise<Browser> | null = null;
  private activeRenders = 0;
  private readonly renderQueue: Array<() => void> = [];

  async renderPdf(html: string): Promise<Uint8Array> {
    return this.withRenderSlot(() => this.renderPdfPage(html));
  }

  private async renderPdfPage(html: string): Promise<Uint8Array> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      page.setDefaultTimeout(30_000);
      page.setDefaultNavigationTimeout(30_000);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const requestUrl = request.url();
        if (
          requestUrl === 'about:blank' ||
          requestUrl.startsWith('data:') ||
          requestUrl.startsWith('blob:') ||
          isAllowedRemoteAssetUrl(requestUrl)
        ) {
          void request.continue();
          return;
        }

        void request.abort();
      });
      await page.setContent(html, { waitUntil: 'networkidle0' });
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        scale: 0.92,
        margin: { top: '10px', right: '10px', bottom: '10px', left: '10px' },
      });
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async withRenderSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeRenders >= this.maxConcurrentRenders) {
      await new Promise<void>((resolve) => this.renderQueue.push(resolve));
    }

    this.activeRenders += 1;
    try {
      return await task();
    } finally {
      this.activeRenders = Math.max(0, this.activeRenders - 1);
      this.renderQueue.shift()?.();
    }
  }

  async onModuleDestroy() {
    const pending = this.browserPromise;
    this.browserPromise = null;
    if (!pending) {
      return;
    }

    try {
      const browser = await pending;
      await browser.close();
    } catch {
      // El browser ya estaba cerrado o nunca termino de iniciar.
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browserPromise) {
      const existing = await this.browserPromise.catch(() => null);
      if (existing?.connected) {
        return existing;
      }
      this.browserPromise = null;
      this.logger.warn('Puppeteer browser disconnected; relaunching');
    }

    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;

    this.browserPromise = puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      return await this.browserPromise;
    } catch (error) {
      this.browserPromise = null;
      this.logger.error('Failed to launch Puppeteer browser', error);
      throw error;
    }
  }
}
