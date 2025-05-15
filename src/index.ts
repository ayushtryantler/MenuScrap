import express from 'express';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

interface MenuItem {
  Category: string;
  Item: string;
  Description: string;
  Price: string;
  Comment: string;
}

const app = express();
const PORT = process.env.PORT || 3000;

const fetchMenuData = async (url: string): Promise<MenuItem[]> => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('[data-testid="card"]', { timeout: 15000 });

    const items = await page.evaluate(() => {
      const menuItems: MenuItem[] = [];
      const cardSelector = '[data-testid="card"]';
      const allElements = Array.from(document.querySelectorAll('body *'));
      let currentCategory = 'Uncategorized';

      allElements.forEach(el => {
        const isHeading = el.tagName === 'H2' || el.tagName === 'H3';
        const isInsideCard = el.closest(cardSelector);
        if (isHeading && !isInsideCard) {
          const headingText = el.textContent?.trim();
          if (headingText && headingText.length < 100) {
            currentCategory = headingText;
          }
        }
        if (el.matches(cardSelector)) {
          const nameEl = el.querySelector('h3, h4, [data-testid*="item-name"]');
          const priceEl = el.querySelector('[data-testid="card-item-price"]');
          const descEl = el.querySelector('[class*="styles_description"]');

          const name = nameEl?.textContent?.trim() || '';
          const price = priceEl?.textContent?.trim() || '';
          const description = descEl?.textContent?.trim() || '';

          if (name) {
            menuItems.push({
              Category: currentCategory,
              Item: name,
              Description: description,
              Price: price,
              Comment: el.textContent?.includes('Unavailable') ? 'Unavailable' : ''
            });
          }
        }
      });
      return menuItems.filter(item => item.Item);
    });

    return items;
  } catch (err) {
    console.error('Error scraping:', err);
    return [];
  } finally {
    await browser.close();
  }
};

const exportToExcel = (data: MenuItem[], filePath: string) => {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Menu');
  XLSX.writeFile(wb, filePath);
};

// JSON endpoint
app.get('/fetch-menu', async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: 'URL parameter is required' });

  const data = await fetchMenuData(url);
  res.json(data);
});

// Excel download endpoint
app.get('/fetch-menu-excel', async (req, res) => {
  const url = req.query.url as string;
  if (!url) return res.status(400).json({ error: 'URL parameter is required' });

  const data = await fetchMenuData(url);
  if (data.length === 0) return res.status(404).json({ error: 'No data found' });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `CloverMenu_${timestamp}.xlsx`;
  const filepath = path.join(__dirname, filename);

  exportToExcel(data, filepath);

  res.download(filepath, filename, err => {
    if (err) {
      console.error('Download error:', err);
      res.status(500).send('Error downloading file');
    }
    // Delete file after sending
    fs.unlink(filepath, err => {
      if (err) console.error('Failed to delete file:', err);
    });
  });
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
