import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.join(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 3000;

const data = path.join(root, 'data');
const uploads = path.join(data, 'uploads');
const books = path.join(root, 'public', 'books');

[data, uploads, books].forEach(dir => {
  fs.mkdirSync(dir, { recursive: true });
});

const db = path.join(data, 'orders.json');

let orders = {};

if (fs.existsSync(db)) {
  try {
    orders = JSON.parse(fs.readFileSync(db, 'utf8'));
  } catch (error) {
    console.error('ORDERS FILE ERROR:', error);
    orders = {};
  }
}

function save() {
  fs.writeFileSync(db, JSON.stringify(orders, null, 2));
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// =====================================================
// STATIC FILES
// =====================================================

app.use(express.static(path.join(root, 'public')));

app.get('/story-assets/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);

  if (!/\.(png|jpg|jpeg)$/i.test(filename)) {
    return res.status(404).end();
  }

  const filePath = path.join(root, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).end();
  }

  res.sendFile(filePath);
});

// =====================================================
// WEBSITE PAGES
// =====================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(root, 'index.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(root, 'index.html'));
});

app.get('/bhavik-story.html', (req, res) => {
  res.sendFile(path.join(root, 'bhavik-story.html'));
});

app.get('/story.html', (req, res) => {
  res.sendFile(path.join(root, 'story.html'));
});

// =====================================================
// TEST
// =====================================================

app.get('/test', (req, res) => {
  res.send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>KidsImagination Test</title>
      </head>

      <body style="
        font-family:Arial;
        padding:40px;
        background:#fffaf0;
        color:#30264d;
      ">

        <h1>KidsImagination is working ✅</h1>

        <p>The Render server is running correctly.</p>

        <p><a href="/">Open KidsImagination homepage</a></p>

        <p><a href="/bhavik-story.html">Open Bhavik's story</a></p>

      </body>
    </html>
  `);
});

// =====================================================
// FILE UPLOAD
// =====================================================

const upload = multer({
  dest: uploads,
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

app.post('/api/upload-photo', upload.single('photo'), (req, res) => {

  console.log('PHOTO UPLOAD REQUEST');

  if (!req.file) {
    return res.status(400).json({
      error: 'Photo required'
    });
  }

  console.log('PHOTO UPLOADED:', req.file.filename);

  res.json({
    photoId: req.file.filename
  });
});

// =====================================================
// RAZORPAY
// =====================================================

const razorpay =
  process.env.RAZORPAY_KEY_ID &&
  process.env.RAZORPAY_KEY_SECRET
    ? new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      })
    : null;

// =====================================================
// CREATE ORDER
// =====================================================

app.post('/api/create-order', async (req, res) => {

  console.log('CREATE ORDER REQUEST');

  try {

    if (!razorpay) {
      return res.status(503).json({
        error: 'Razorpay is not configured'
      });
    }

    const data = req.body || {};

    if (!data.childName || !data.age || !data.theme) {
      return res.status(400).json({
        error: 'Child name, age and theme are required'
      });
    }

    const amount = Number(data.amount);

    if (![39900, 59900, 79900].includes(amount)) {
      return res.status(400).json({
        error: 'Invalid package'
      });
    }

    const packageName =
      amount === 39900
        ? 'story'
        : amount === 59900
          ? 'story-audio'
          : 'premium';

    const order = await razorpay.orders.create({
      amount,
      currency: 'INR',
      receipt: 'KI' + Date.now(),
      payment_capture: 1
    });

    orders[order.id] = {

      id: order.id,

      status: 'created',

      amount,

      packageName,

      data

    };

    save();

    console.log(
      'RAZORPAY ORDER CREATED:',
      order.id
    );

    res.json({

      keyId:
        process.env.RAZORPAY_KEY_ID,

      orderId:
        order.id,

      amount:
        order.amount

    });

  } catch (error) {

    console.error(
      'ORDER CREATION ERROR:',
      error
    );

    res.status(500).json({
      error: 'Order creation failed'
    });

  }

});

// =====================================================
// PAYMENT VERIFICATION
// =====================================================

app.post('/api/verify-payment', async (req, res) => {

  console.log('VERIFY PAYMENT REQUEST');

  try {

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderId
    } = req.body;

    const order =
      orders[
        orderId ||
        razorpay_order_id
      ];

    if (!order) {

      return res.status(404).json({
        error: 'Order not found'
      });

    }

    if (order.id !== razorpay_order_id) {

      return res.status(400).json({
        error: 'Order ID mismatch'
      });

    }

    const expectedSignature =
      crypto
        .createHmac(
          'sha256',
          process.env.RAZORPAY_KEY_SECRET
        )
        .update(
          `${razorpay_order_id}|${razorpay_payment_id}`
        )
        .digest('hex');

    if (
      !razorpay_signature ||
      expectedSignature !== razorpay_signature
    ) {

      return res.status(400).json({
        error: 'Payment verification failed'
      });

    }

    order.status = 'generating';

    order.paymentId =
      razorpay_payment_id;

    save();

    console.log(
      'PAYMENT VERIFIED:',
      order.id
    );

    generate(order.id)
      .then(() => {

        console.log(
          'STORY GENERATION FINISHED:',
          order.id
        );

      })
      .catch(error => {

        console.error(
          'STORY GENERATION ERROR:',
          error
        );

        order.status = 'failed';

        order.error =
          error?.message ||
          'Generation failed. Please contact support.';

        save();

      });

    res.json({

      ok: true,

      orderId:
        order.id

    });

  } catch (error) {

    console.error(
      'PAYMENT VERIFICATION ERROR:',
      error
    );

    res.status(500).json({
      error: 'Verification failed'
    });

  }

});

// =====================================================
// STORY STATUS
// =====================================================

app.get('/api/story/:id', (req, res) => {

  const order =
    orders[
      req.params.id
    ];

  if (!order) {

    return res.status(404).json({
      error: 'Not found'
    });

  }

  res.json({

    status:
      order.status,

    title:
      order.title,

    pages:
      order.pages || [],

    pdfUrl:
      order.pdfUrl || null,

    audioUrl:
      order.audioUrl || null,

    error:
      order.error || null

  });

});

// =====================================================
// OPENAI HELPER
// =====================================================

async function ai(
  endpoint,
  body,
  headers = {}
) {

  if (!process.env.OPENAI_API_KEY) {

    throw new Error(
      'OPENAI_API_KEY missing'
    );

  }

  const response =
    await fetch(
      'https://api.openai.com/v1/' +
      endpoint,
      {

        method: 'POST',

        headers: {

          Authorization:
            `Bearer ${process.env.OPENAI_API_KEY}`,

          ...headers

        },

        body

      }
    );

  if (!response.ok) {

    const errorText =
      await response.text();

    throw new Error(
      'OpenAI ' +
      response.status +
      ' ' +
      errorText.slice(0, 1000)
    );

  }

  return response;

}

// =====================================================
// CREATE STORY
// =====================================================

async function makeStory(data) {

  const prompt = `

Create a personalized children's picture book for a child aged 1–5.

Child name: ${data.childName}
Age: ${data.age}
Theme: ${data.theme}
Favorite things: ${data.favorite || 'none'}
Favorite color: ${data.favoriteColor || 'none'}
Favorite animal: ${data.animal || 'none'}
Personality: ${data.personality || 'none'}
Dedication: ${data.dedication || 'none'}

Create ONE complete connected story.

Create exactly 6 pages.

All six pages must feel like one continuous adventure.

The child is the main character throughout.

Use very simple vocabulary suitable for ages 1–5.

Each page must contain only 1–3 short sentences.

Each page must have a clear action that can be illustrated.

The final page must have a warm, happy ending.

STORY STRUCTURE:

Page 1:
Introduce the child, setting and adventure.

Page 2:
The child discovers something interesting.

Page 3:
The adventure begins and the child meets a friendly character.

Page 4:
A small age-appropriate problem or surprise happens.

Page 5:
The child solves the problem through kindness, teamwork, curiosity or imagination.

Page 6:
The adventure ends happily.

Do not create scary, violent, dangerous or sad situations.

CHARACTER:

The uploaded child photo is the identity reference.

Keep the same child throughout every illustration.

Keep consistent:
- face
- eyes
- nose
- mouth
- hairstyle
- hair color
- skin tone
- age
- body proportions

Do not create a different child.

VISUAL CONTINUITY:

The six illustrations must look like parts of the same picture book.

Keep returning characters, locations and objects visually consistent.

IMAGE PROMPT:

Describe:
- child pose
- expression
- clothing
- environment
- important objects
- other characters
- exact action
- connection to previous page
- colorful children's picture-book style

IMPORTANT:

Do NOT put text inside the generated illustration.

No words.
No letters.
No captions.
No logos.
No watermark.

The website will add the story text separately.

RETURN ONLY VALID JSON.

Use exactly:

{
  "title": "Story title",
  "pages": [
    {
      "title": "Page title",
      "text": "Short connected story text",
      "imagePrompt": "Detailed illustration prompt"
    }
  ]
}

`;

  const r =
    await ai(
      'chat/completions',

      JSON.stringify({

        model:
          process.env.OPENAI_TEXT_MODEL ||
          'gpt-4.1-mini',

        messages: [

          {
            role: 'system',

            content:
              'Create warm connected childrens picture books. Return valid JSON only.'
          },

          {
            role: 'user',

            content:
              prompt
          }

        ],

        temperature: 0.8,

        response_format: {
          type: 'json_object'
        }

      }),

      {
        'Content-Type':
          'application/json'
      }

    );

  const j =
    await r.json();

  const outputText =
    j.choices?.[0]?.message?.content;

  if (!outputText) {

    throw new Error(
      'OpenAI returned no story content'
    );

  }

  let story;

  try {

    story =
      JSON.parse(
        outputText
      );

  } catch {

    throw new Error(
      'OpenAI returned invalid story JSON'
    );

  }

  if (
    !story.title ||
    !Array.isArray(story.pages) ||
    story.pages.length !== 6
  ) {

    throw new Error(
      'OpenAI returned an invalid 6-page story'
    );

  }

  return story;

}

// =====================================================
// CREATE IMAGE
// =====================================================

async function makeImage(
  prompt,
  photo
) {

  if (!fs.existsSync(photo)) {

    throw new Error(
      'Uploaded child photo not found'
    );

  }

  const f =
    new FormData();

  f.append(
    'model',
    process.env.OPENAI_IMAGE_MODEL ||
    'gpt-image-2'
  );

  f.append(
    'prompt',

    prompt +

    `

IMPORTANT CHARACTER CONSISTENCY:

Use the uploaded child photo as the primary identity reference.

The child must remain the same child throughout the entire book.

Preserve:
- face shape
- eyes
- nose
- mouth
- hairstyle
- hair color
- skin tone
- age
- facial proportions

Do not create a different child.

Create a polished colorful children's picture-book illustration.

NO text.
NO letters.
NO captions.
NO logos.
NO watermark.

The story text is added separately by the website.
`
  );

  f.append(
    'size',
    '1024x1024'
  );

  f.append(
    'image',

    new Blob(
      [
        fs.readFileSync(photo)
      ],
      {
        type: 'image/jpeg'
      }
    ),

    'child.jpg'
  );

  const r =
    await ai(
      'images/edits',
      f
    );

  const j =
    await r.json();

  if (
    !j.data ||
    !j.data[0] ||
    !j.data[0].b64_json
  ) {

    throw new Error(
      'OpenAI image generation returned no image'
    );

  }

  return Buffer.from(
    j.data[0].b64_json,
    'base64'
  );

}

// =====================================================
// CREATE AUDIO
// =====================================================

async function makeAudio(text) {

  const r =
    await ai(
      'audio/speech',

      JSON.stringify({

        model:
          process.env.OPENAI_TTS_MODEL ||
          'gpt-4o-mini-tts',

        voice:
          'alloy',

        input:
          text,

        response_format:
          'mp3'

      }),

      {
        'Content-Type':
          'application/json'
      }

    );

  return Buffer.from(
    await r.arrayBuffer()
  );

}

// =====================================================
// ADD STORY TEXT TO IMAGE
// CLEAN CLOUD DESIGN
// =====================================================

async function addStoryTextToImage(
  imageBuffer,
  storyText,
  pageNumber
) {

  console.log(
    `ADDING STORY TEXT TO PAGE ${pageNumber}`
  );

  const width = 1024;
  const height = 1024;

  function escapeXml(text) {

    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  }

  /*
   * We deliberately keep the text area narrower
   * than the image so text can NEVER touch
   * the left or right edge.
   */

  const maxChars = 34;

  function wrapText(text, max) {

    const words =
      String(text)
        .trim()
        .split(/\s+/);

    const lines = [];

    let line = '';

    for (const word of words) {

      const test =
        line
          ? `${line} ${word}`
          : word;

      if (test.length > max) {

        if (line) {
          lines.push(line);
        }

        line = word;

      } else {

        line = test;

      }

    }

    if (line) {
      lines.push(line);
    }

    return lines;

  }

  let fontSize = 38;
  let lineHeight = 47;
  let lines = wrapText(
    storyText,
    maxChars
  );

  /*
   * Automatically make long text smaller.
   */

  if (lines.length > 4) {

    fontSize = 34;
    lineHeight = 43;

    lines =
      wrapText(
        storyText,
        39
      );

  }

  if (lines.length > 5) {

    fontSize = 30;
    lineHeight = 39;

    lines =
      wrapText(
        storyText,
        44
      );

  }

  if (lines.length > 6) {

    fontSize = 27;
    lineHeight = 35;

    lines =
      wrapText(
        storyText,
        49
      );

  }

  /*
   * Never allow an excessively tall text box.
   */

  if (lines.length > 7) {

    lines =
      lines.slice(0, 7);

    lines[6] =
      lines[6].replace(
        /[,.!?;:]*$/,
        '…'
      );

  }

  const horizontalPadding = 75;
  const top = 34;

  const textHeight =
    lines.length * lineHeight;

  const cloudHeight =
    Math.max(
      170,
      textHeight + 80
    );

  /*
   * Safe maximum.
   */

  const finalCloudHeight =
    Math.min(
      cloudHeight,
      390
    );

  const cloudX =
    horizontalPadding;

  const cloudWidth =
    width -
    horizontalPadding * 2;

  const textCenterX =
    width / 2;

  const startY =
    top +
    (
      finalCloudHeight -
      textHeight
    ) / 2 +
    fontSize * 0.78;

  const svgText =
    lines
      .map(
        (line, index) => {

          const y =
            startY +
            index * lineHeight;

          return `
            <text
              x="${textCenterX}"
              y="${y}"
              text-anchor="middle"
              font-family="Arial Rounded MT Bold, Arial, sans-serif"
              font-size="${fontSize}px"
              font-weight="700"
              fill="#21145f"
            >
              ${escapeXml(line)}
            </text>
          `;

        }
      )
      .join('');

  /*
   * Soft cloud-like shape.
   *
   * Unlike the old version, this does NOT
   * create dozens of overlapping circles.
   */

  const cloudRight =
    cloudX + cloudWidth;

  const cloudBottom =
    top + finalCloudHeight;

  const svg = `
    <svg
      width="${width}"
      height="${height}"
      viewBox="0 0 ${width} ${height}"
      xmlns="http://www.w3.org/2000/svg"
    >

      <defs>

        <filter
          id="shadow"
          x="-20%"
          y="-20%"
          width="140%"
          height="150%"
        >

          <feDropShadow
            dx="0"
            dy="5"
            stdDeviation="7"
            flood-color="#000000"
            flood-opacity="0.16"
          />

        </filter>

      </defs>

      <!-- =========================================
           SOFT CLOUD / TEXT PANEL
           ========================================= -->

      <g filter="url(#shadow)">

        <path
          d="
            M ${cloudX + 70} ${top + 30}

            C ${cloudX + 40} ${top - 5},
              ${cloudX + 85} ${top - 28},
              ${cloudX + 125} ${top + 5}

            C ${cloudX + 155} ${top - 35},
              ${cloudX + 225} ${top - 35},
              ${cloudX + 250} ${top + 5}

            C ${cloudX + 290} ${top - 30},
              ${cloudX + 365} ${top - 25},
              ${cloudX + 390} ${top + 10}

            C ${cloudX + 435} ${top - 25},
              ${cloudX + 510} ${top - 20},
              ${cloudX + 530} ${top + 12}

            C ${cloudX + 575} ${top - 20},
              ${cloudX + 650} ${top - 15},
              ${cloudX + 675} ${top + 15}

            C ${cloudX + 720} ${top - 10},
              ${cloudX + 780} ${top + 5},
              ${cloudX + 775} ${top + 40}

            L ${cloudRight - 30} ${top + 55}

            Q ${cloudRight} ${top + 55},
              ${cloudRight} ${top + 85}

            L ${cloudRight} ${cloudBottom - 55}

            Q ${cloudRight} ${cloudBottom},
              ${cloudRight - 35} ${cloudBottom}

            L ${cloudX + 35} ${cloudBottom}

            Q ${cloudX} ${cloudBottom},
              ${cloudX} ${cloudBottom - 35}

            L ${cloudX} ${top + 65}

            Q ${cloudX} ${top + 30},
              ${cloudX + 35} ${top + 30}

            Z
          "

          fill="#ffffff"
          fill-opacity="0.88"

          stroke="#ffffff"
          stroke-opacity="0.70"
          stroke-width="3"
        />

      </g>

      <!-- =========================================
           STORY TEXT
           ========================================= -->

      ${svgText}

    </svg>
  `;

  return await sharp(imageBuffer)
    .composite([
      {
        input:
          Buffer.from(svg),
        top: 0,
        left: 0
      }
    ])
    .png()
    .toBuffer();

}

// =====================================================
// CREATE PDF
// =====================================================

function makePdf(
  id,
  st,
  imgs
) {

  return new Promise(
    (resolve, reject) => {

      const file =
        path.join(
          books,
          id + '.pdf'
        );

      const doc =
        new PDFDocument({

          size: 'A5',

          margin: 0

        });

      const stream =
        fs.createWriteStream(
          file
        );

      stream.on(
        'finish',
        () => {

          resolve(
            '/books/' +
            id +
            '.pdf'
          );

        }
      );

      stream.on(
        'error',
        reject
      );

      doc.pipe(stream);

      // =================================================
      // COVER
      // =================================================

      doc.rect(
        0,
        0,
        doc.page.width,
        doc.page.height
      )
      .fill('#fff8f0');

      doc
        .font('Helvetica-Bold')
        .fontSize(30)
        .fillColor('#3d315d')
        .text(
          st.title,
          35,
          110,
          {
            width:
              doc.page.width - 70,

            align:
              'center'
          }
        );

      doc
        .font('Helvetica')
        .fontSize(14)
        .fillColor('#777777')
        .text(
          'A personalized story created especially for your little one ✨',
          40,
          175,
          {
            width:
              doc.page.width - 80,

            align:
              'center'
          }
        );

      // =================================================
      // STORY ILLUSTRATIONS
      // =================================================

      st.pages.forEach(
        (page, index) => {

          doc.addPage({
            size: 'A5',
            margin: 0
          });

          doc.image(
            imgs[index],
            0,
            0,
            {
              fit: [
                doc.page.width,
                doc.page.height
              ],

              align: 'center',

              valign: 'center'
            }
          );

        }
      );

      doc.end();

    }
  );

}

// =====================================================
// GENERATE COMPLETE BOOK
// =====================================================

async function generate(id) {

  console.log(
    '======================================'
  );

  console.log(
    'GENERATING BOOK:',
    id
  );

  console.log(
    '======================================'
  );

  const o =
    orders[id];

  if (!o) {
    throw new Error(
      'Order not found'
    );
  }

  const st =
    await makeStory(
      o.data
    );

  const photo =
    path.join(
      uploads,
      o.data.photoId
    );

  if (!fs.existsSync(photo)) {

    throw new Error(
      'Child photo file not found'
    );

  }

  const imgs = [];
  const pages = [];

  // ===================================================
  // CREATE 6 ILLUSTRATIONS
  // ===================================================

  for (
    let i = 0;
    i < st.pages.length;
    i++
  ) {

    console.log(
      `CREATING PAGE ${i + 1}/6`
    );

    const image =
      await makeImage(
        st.pages[i].imagePrompt,
        photo
      );

    const finalImage =
      await addStoryTextToImage(
        image,
        st.pages[i].text,
        i + 1
      );

    const imageFile =
      path.join(
        books,
        `${id}-${i + 1}.png`
      );

    fs.writeFileSync(
      imageFile,
      finalImage
    );

    imgs.push(
      imageFile
    );

    // -----------------------------------------------
    // PAGE AUDIO
    // -----------------------------------------------

    let pageAudioUrl = null;

    if (
      o.amount >= 59900
    ) {

      console.log(
        `CREATING AUDIO FOR PAGE ${i + 1}`
      );

      const audio =
        await makeAudio(
          st.pages[i].text
        );

      const audioFile =
        path.join(
          books,
          `${id}-page-${i + 1}.mp3`
        );

      fs.writeFileSync(
        audioFile,
        audio
      );

      pageAudioUrl =
        `/books/${id}-page-${i + 1}.mp3`;

    }

    pages.push({

      ...st.pages[i],

      imageUrl:
        `/books/${id}-${i + 1}.png`,

      audioUrl:
        pageAudioUrl

    });

    o.pages =
      pages;

    o.title =
      st.title;

    save();

  }

  // ===================================================
  // PDF
  // ===================================================

  console.log(
    'CREATING PDF...'
  );

  o.pdfUrl =
    await makePdf(
      id,
      st,
      imgs
    );

  console.log(
    'PDF CREATED:',
    o.pdfUrl
  );

  // ===================================================
  // COMPLETE AUDIOBOOK
  // ===================================================

  if (
    o.amount >= 59900
  ) {

    console.log(
      'CREATING COMPLETE AUDIOBOOK...'
    );

    const fullText =
      st.pages
        .map(
          p => p.text
        )
        .join(' ');

    const audiobook =
      await makeAudio(
        fullText
      );

    const audiobookFile =
      path.join(
        books,
        `${id}-audiobook.mp3`
      );

    fs.writeFileSync(
      audiobookFile,
      audiobook
    );

    o.audioUrl =
      `/books/${id}-audiobook.mp3`;

    console.log(
      'COMPLETE AUDIOBOOK CREATED'
    );

  }

  // ===================================================
  // READY
  // ===================================================

  o.status =
    'ready';

  o.error =
    undefined;

  save();

  console.log(
    '======================================'
  );

  console.log(
    'BOOK READY:',
    id
  );

  console.log(
    '======================================'
  );

}

// =====================================================
// START SERVER
// =====================================================

app.listen(
  PORT,
  () => {

    console.log(
      `KidsImagination running on port ${PORT}`
    );

    console.log(
      'Loaded orders:',
      Object.keys(orders).length
    );

    // -------------------------------------------------
    // RESUME INTERRUPTED STORIES
    // -------------------------------------------------

    Object.values(
      orders
    ).forEach(
      order => {

        if (
          order.status === 'generating' &&
          order.paymentId
        ) {

          console.log(
            'RESUMING:',
            order.id
          );

          generate(
            order.id
          )
          .then(() => {

            console.log(
              'RESUMED STORY FINISHED:',
              order.id
            );

          })
          .catch(error => {

            console.error(
              'RESUMED STORY FAILED:',
              error
            );

            order.status =
              'failed';

            order.error =
              error?.message ||
              'Generation failed.';

            save();

          });

        }

      }
    );

  }
);
