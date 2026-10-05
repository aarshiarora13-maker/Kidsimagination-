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
  fs.writeFileSync(
    db,
    JSON.stringify(orders, null, 2)
  );
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// =====================================================
// STATIC FILES
// =====================================================

app.use(
  express.static(
    path.join(root, 'public')
  )
);

// Serve story illustration images stored in repository root
app.get('/story-assets/:filename', (req, res) => {

  const filename =
    path.basename(req.params.filename);

  if (!/\.(png|jpg|jpeg)$/i.test(filename)) {
    return res.status(404).end();
  }

  const filePath =
    path.join(root, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).end();
  }

  res.sendFile(filePath);
});

// =====================================================
// WEBSITE PAGES
// =====================================================

app.get('/', (req, res) => {
  res.sendFile(
    path.join(root, 'index.html')
  );
});

app.get('/index.html', (req, res) => {
  res.sendFile(
    path.join(root, 'index.html')
  );
});

app.get('/bhavik-story.html', (req, res) => {
  res.sendFile(
    path.join(root, 'bhavik-story.html')
  );
});

app.get('/story.html', (req, res) => {
  res.sendFile(
    path.join(root, 'story.html')
  );
});

// =====================================================
// TEST PAGE
// =====================================================

app.get('/test', (req, res) => {

  res.send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1"
        >
        <title>KidsImagination Test</title>
      </head>

      <body style="
        font-family:Arial;
        padding:40px;
        background:#fffaf0;
        color:#30264d;
      ">

        <h1>KidsImagination is working ✅</h1>

        <p>
          The Render server is running correctly.
        </p>

        <p>
          <a href="/">
            Open KidsImagination homepage
          </a>
        </p>

        <p>
          <a href="/bhavik-story.html">
            Open Bhavik's story
          </a>
        </p>

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

app.post(
  '/api/upload-photo',
  upload.single('photo'),
  (req, res) => {

    console.log('PHOTO UPLOAD REQUEST');

    if (!req.file) {
      return res.status(400).json({
        error: 'Photo required'
      });
    }

    console.log(
      'PHOTO UPLOADED:',
      req.file.filename
    );

    res.json({
      photoId: req.file.filename
    });
  }
);

// =====================================================
// RAZORPAY
// =====================================================

const razorpay =
  process.env.RAZORPAY_KEY_ID &&
  process.env.RAZORPAY_KEY_SECRET
    ? new Razorpay({
        key_id:
          process.env.RAZORPAY_KEY_ID,

        key_secret:
          process.env.RAZORPAY_KEY_SECRET
      })
    : null;

// =====================================================
// CREATE ORDER
// =====================================================

app.post(
  '/api/create-order',
  async (req, res) => {

    console.log(
      'CREATE ORDER REQUEST'
    );

    try {

      if (!razorpay) {

        return res.status(503).json({
          error:
            'Razorpay is not configured'
        });
      }

      const data =
        req.body || {};

      if (
        !data.childName ||
        !data.age ||
        !data.theme
      ) {

        return res.status(400).json({
          error:
            'Child name, age and theme are required'
        });
      }

      const amount =
        Number(data.amount);

      if (
        ![
          39900,
          59900,
          79900
        ].includes(amount)
      ) {

        return res.status(400).json({
          error:
            'Invalid package'
        });
      }

      const packageName =
        amount === 39900
          ? 'story'
          : amount === 59900
            ? 'story-audio'
            : 'premium';

      console.log(
        'CREATING RAZORPAY ORDER:',
        amount,
        packageName
      );

      const order =
        await razorpay.orders.create({

          amount,

          currency: 'INR',

          receipt:
            'KI' + Date.now(),

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
        error:
          'Order creation failed'
      });
    }
  }
);

// =====================================================
// PAYMENT VERIFICATION
// =====================================================

app.post(
  '/api/verify-payment',
  async (req, res) => {

    console.log(
      'VERIFY PAYMENT REQUEST'
    );

    try {

      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        orderId
      } = req.body;

      console.log(
        'PAYMENT DATA:',
        {
          razorpay_order_id,
          razorpay_payment_id,
          orderId
        }
      );

      const order =
        orders[
          orderId ||
          razorpay_order_id
        ];

      if (!order) {

        console.error(
          'ORDER NOT FOUND:',
          orderId ||
          razorpay_order_id
        );

        return res.status(404).json({
          error:
            'Order not found'
        });
      }

      if (
        order.id !==
        razorpay_order_id
      ) {

        return res.status(400).json({
          error:
            'Order ID mismatch'
        });
      }

      const expectedSignature =
        crypto
          .createHmac(
            'sha256',
            process.env
              .RAZORPAY_KEY_SECRET
          )
          .update(
            `${razorpay_order_id}|${razorpay_payment_id}`
          )
          .digest('hex');

      if (
        !razorpay_signature ||
        expectedSignature !==
          razorpay_signature
      ) {

        console.error(
          'PAYMENT SIGNATURE FAILED'
        );

        return res.status(400).json({
          error:
            'Payment verification failed'
        });
      }

      // -------------------------------------------------
      // PAYMENT SUCCESSFULLY VERIFIED
      // -------------------------------------------------

      order.status =
        'generating';

      order.paymentId =
        razorpay_payment_id;

      save();

      console.log(
        'PAYMENT VERIFIED:',
        order.id
      );

      console.log(
        'STARTING STORY GENERATION:',
        order.id
      );

      // Start generation
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

          order.status =
            'failed';

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
        error:
          'Verification failed'
      });
    }
  }
);

// =====================================================
// STORY STATUS
// =====================================================

app.get(
  '/api/story/:id',
  (req, res) => {

    const order =
      orders[
        req.params.id
      ];

    if (!order) {

      return res.status(404).json({
        error:
          'Not found'
      });
    }

    res.json({

      status:
        order.status,

      title:
        order.title,

      pages:
        order.pages,

      pdfUrl:
        order.pdfUrl,

      audioUrl:
        order.audioUrl,

      error:
        order.error
    });
  }
);

// =====================================================
// OPENAI REQUEST HELPER
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

  console.log(
    'OPENAI STORY REQUEST STARTING'
  );

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

STORY REQUIREMENTS:

Create exactly 6 pages.

The child must be the main character and must appear as the central character throughout the entire story.

Write a warm, playful, positive and age-appropriate story that parents will enjoy reading aloud.

Use very simple vocabulary suitable for ages 1–5.

Each page must contain only 1–3 short sentences.

Every page should have a clear action or event so that the illustration can visually show what is happening.

Create a beginning, a small adventure or problem, and a happy ending.

Do not create scary, violent, dangerous or sad situations.

Keep the story imaginative, colorful and emotionally positive.

CHARACTER CONSISTENCY:

The uploaded child photo will be used as the visual identity reference.

Every imagePrompt must instruct the image generator to keep the same recognizable child character throughout the entire book.

Keep consistent:
- facial identity
- face shape
- eyes
- nose
- mouth
- hairstyle
- hair color
- skin tone
- age appearance
- body proportions

Do not make the child look like a different child from one page to another.

IMAGE PROMPTS:

Each page must have a detailed imagePrompt describing:
- the child's pose
- facial expression
- clothing
- location/environment
- lighting
- important objects
- other characters
- the action taking place
- colorful children's picture-book illustration style

The imagePrompt must NOT contain written text, letters, captions, logos or watermarks.

RETURN ONLY VALID JSON in exactly this structure:

{
  "title": "Story title",
  "pages": [
    {
      "title": "Page title",
      "text": "Short story text",
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
              'You create simple, warm, age-appropriate personalized childrens picture books. Always return valid JSON only.'
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

  console.log(
    'OPENAI STORY RESPONSE RECEIVED'
  );

  if (!r.ok) {

    console.error(
      'OPENAI STORY ERROR:',
      JSON.stringify(
        j,
        null,
        2
      )
    );

    throw new Error(
      `OpenAI story generation failed: ${r.status} ${j.error?.message || 'Unknown error'}`
    );
  }

  const outputText =
    j.choices?.[0]?.message?.content;

  if (!outputText) {

    console.error(
      'OPENAI STORY RESPONSE:',
      JSON.stringify(
        j,
        null,
        2
      )
    );

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

  } catch (error) {

    console.error(
      'INVALID STORY JSON:',
      outputText
    );

    throw new Error(
      'OpenAI returned invalid story JSON'
    );
  }

  if (
    !story.title ||
    !Array.isArray(
      story.pages
    ) ||
    story.pages.length !== 6
  ) {

    console.error(
      'INVALID STORY STRUCTURE:',
      JSON.stringify(
        story,
        null,
        2
      )
    );

    throw new Error(
      'OpenAI returned an invalid 6-page story'
    );
  }

  console.log(
    'STORY CREATED SUCCESSFULLY:',
    story.title
  );

  return story;
}

// =====================================================
// CREATE IMAGE
// =====================================================

async function makeImage(
  prompt,
  photo
) {

  console.log(
    'OPENAI IMAGE REQUEST STARTING'
  );

  if (!fs.existsSync(photo)) {

    throw new Error(
      'Uploaded child photo not found: ' +
      photo
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

The child in the illustration must remain the same child across every page of the book.

Preserve the child's recognizable:
- face shape
- eyes
- nose
- mouth
- hairstyle
- hair color
- skin tone
- age appearance
- facial proportions

Do not redesign the child's face.
Do not create a different child.
Do not make the child older or younger.
Do not change the child's skin tone or facial structure.

Create a polished, colorful children's picture-book illustration.

Keep the child's identity recognizable while adapting the photo into a friendly illustrated character.

Use expressive poses and natural facial expressions appropriate to the story.

No written text.
No letters.
No captions.
No logos.
No watermark.
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
        type:
          'image/jpeg'
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

    console.error(
      'IMAGE API RESPONSE:',
      JSON.stringify(
        j,
        null,
        2
      )
    );

    throw new Error(
      'OpenAI image generation returned no image'
    );
  }

  console.log(
    'OPENAI IMAGE CREATED'
  );

  return Buffer.from(
    j.data[0].b64_json,
    'base64'
  );
}

// =====================================================
// CREATE AUDIO
// =====================================================

async function makeAudio(
  text
) {

  console.log(
    'OPENAI AUDIO REQUEST STARTING'
  );

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

  console.log(
    'OPENAI AUDIO CREATED'
  );

  return Buffer.from(
    await r.arrayBuffer()
  );
}

// =====================================================
// CREATE PDF - TEXT OVER ILLUSTRATION
// =====================================================

function makePdf(
  id,
  st,
  imgs
) {

  return new Promise(
    (resolve, reject) => {

      const f =
        path.join(
          books,
          id + '.pdf'
        );

      const d =
        new PDFDocument({

          size: 'A4',

          margin: 0
        });

      const w =
        fs.createWriteStream(f);

      w.on(
        'finish',
        () =>
          resolve(
            '/books/' +
            id +
            '.pdf'
          )
      );

      w.on(
        'error',
        reject
      );

      d.pipe(w);

      // -------------------------------------------------
      // COVER PAGE
      // -------------------------------------------------

      d.rect(
        0,
        0,
        d.page.width,
        d.page.height
      )
        .fill('#fff8f0');

      d.fontSize(34)
        .fillColor('#3d315d')
        .font('Helvetica-Bold')
        .text(
          st.title,
          50,
          100,
          {
            width:
              d.page.width - 100,

            align:
              'center'
          }
        );

      d.fontSize(16)
        .fillColor('#777777')
        .font('Helvetica')
        .text(
          'A personalized story created especially for your little one ✨',
          60,
          170,
          {
            width:
              d.page.width - 120,

            align:
              'center'
          }
        );

      // -------------------------------------------------
      // STORY PAGES
      // -------------------------------------------------

      st.pages.forEach(
        (p, i) => {

          d.addPage({
            size: 'A4',
            margin: 0
          });

          const pageWidth =
            d.page.width;

          const pageHeight =
            d.page.height;

          // -------------------------------------------------
          // FULL PAGE ILLUSTRATION
          // -------------------------------------------------

          d.image(
            imgs[i],
            0,
            0,
            {
              cover: [
                pageWidth,
                pageHeight
              ],
              align: 'center',
              valign: 'center'
            }
          );

          // -------------------------------------------------
          // WHITE TRANSPARENT TEXT PANEL
          // -------------------------------------------------

          const panelX = 28;
          const panelY = 28;

          const panelWidth =
            pageWidth - 56;

          const panelHeight = 175;

          d.save();

          d.roundedRect(
            panelX,
            panelY,
            panelWidth,
            panelHeight,
            18
          )
            .fillOpacity(0.90)
            .fill('#ffffff');

          d.restore();

          // -------------------------------------------------
          // PAGE TITLE
          // -------------------------------------------------

          if (p.title) {

            d.font(
              'Helvetica-Bold'
            )
              .fontSize(19)
              .fillColor('#7156d8')
              .text(
                p.title,
                panelX + 20,
                panelY + 16,
                {
                  width:
                    panelWidth - 40,

                  align:
                    'center'
                }
              );
          }

          // -------------------------------------------------
          // STORY TEXT ON ILLUSTRATION
          // -------------------------------------------------

          d.font(
            'Helvetica'
          )
            .fontSize(16)
            .fillColor('#302746')
            .text(
              p.text,
              panelX + 22,
              panelY + 55,
              {
                width:
                  panelWidth - 44,

                height:
                  panelHeight - 70,

                align:
                  'center',

                lineGap:
                  5
              }
            );

          // -------------------------------------------------
          // SMALL PAGE NUMBER
          // -------------------------------------------------

          d.save();

          d.circle(
            pageWidth - 38,
            pageHeight - 38,
            15
          )
            .fillOpacity(0.85)
            .fill('#ffffff');

          d.restore();

          d.font(
            'Helvetica-Bold'
          )
            .fontSize(10)
            .fillColor('#7156d8')
            .text(
              String(i + 1),
              pageWidth - 43,
              pageHeight - 43,
              {
                width: 10,
                align: 'center'
              }
            );
        }
      );

      d.end();
    }
  );
}

// =====================================================
// GENERATE COMPLETE BOOK
// =====================================================

async function generate(
  id
) {

  console.log(
    '======================================'
  );

  console.log(
    'GENERATE FUNCTION STARTED:',
    id
  );

  console.log(
    '======================================'
  );

  if (!process.env.OPENAI_API_KEY) {

    throw new Error(
      'OPENAI_API_KEY missing'
    );
  }

  const o =
    orders[id];

  if (!o) {

    throw new Error(
      'Order not found: ' +
      id
    );
  }

  console.log(
    'ORDER FOUND:',
    id
  );

  console.log(
    'CREATING STORY WITH OPENAI...'
  );

  const st =
    await makeStory(
      o.data
    );

  console.log(
    'STORY CREATED:',
    st.title
  );

  const photo =
    path.join(
      uploads,
      o.data.photoId
    );

  if (!fs.existsSync(photo)) {

    throw new Error(
      'Child photo file not found: ' +
      photo
    );
  }

  const imgs = [];
  const pages = [];

  for (
    let i = 0;
    i < st.pages.length;
    i++
  ) {

    console.log(
      `CREATING IMAGE ${i + 1} OF ${st.pages.length}...`
    );

    const b =
      await makeImage(
        st.pages[i].imagePrompt,
        photo
      );

    const f =
      path.join(
        books,
        `${id}-${i + 1}.png`
      );

    fs.writeFileSync(
      f,
      b
    );

    console.log(
      `IMAGE ${i + 1} CREATED`
    );

    imgs.push(f);

    pages.push({

      ...st.pages[i],

      imageUrl:
        `/books/${id}-${i + 1}.png`
    });

    // Save progress after every image
    o.pages =
      pages;

    o.title =
      st.title;

    save();
  }

  console.log(
    'ALL 6 IMAGES CREATED'
  );

  o.title =
    st.title;

  o.pages =
    pages;

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

  if (
    o.amount >= 59900
  ) {

    console.log(
      'CREATING AUDIO...'
    );

    const b =
      await makeAudio(
        st.pages
          .map(
            p => p.text
          )
          .join(' ')
      );

    const f =
      path.join(
        books,
        id + '.mp3'
      );

    fs.writeFileSync(
      f,
      b
    );

    o.audioUrl =
      '/books/' +
      id +
      '.mp3';

    console.log(
      'AUDIO CREATED:',
      o.audioUrl
    );
  }

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
    // RESUME INTERRUPTED PAID STORIES
    // -------------------------------------------------

    Object.values(
      orders
    ).forEach(
      order => {

        if (
          order.status ===
            'generating' &&
          order.paymentId
        ) {

          console.log(
            'RESUMING INTERRUPTED STORY:',
            order.id
          );

          generate(
            order.id
          )
            .then(
              () => {

                console.log(
                  'RESUMED STORY FINISHED:',
                  order.id
                );
              }
            )
            .catch(
              error => {

                console.error(
                  'RESUMED STORY FAILED:',
                  error
                );

                order.status =
                  'failed';

                order.error =
                  error?.message ||
                  'Generation failed. Please contact support.';

                save();
              }
            );
        }
      }
    );
  }
);
