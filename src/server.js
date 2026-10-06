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
  fs.writeFileSync(
    db,
    JSON.stringify(orders, null, 2)
  );
}

app.use(cors());

app.use(
  express.json({
    limit: '2mb'
  })
);


// =====================================================
// STATIC FILES
// =====================================================

app.use(
  express.static(
    path.join(root, 'public')
  )
);


// =====================================================
// STORY ASSETS
// =====================================================

app.get(
  '/story-assets/:filename',
  (req, res) => {

    const filename =
      path.basename(
        req.params.filename
      );

    if (
      !/\.(png|jpg|jpeg)$/i.test(
        filename
      )
    ) {
      return res.status(404).end();
    }

    const filePath =
      path.join(
        root,
        filename
      );

    if (
      !fs.existsSync(filePath)
    ) {
      return res.status(404).end();
    }

    res.sendFile(filePath);

  }
);


// =====================================================
// WEBSITE PAGES
// =====================================================

app.get(
  '/',
  (req, res) => {

    res.sendFile(
      path.join(
        root,
        'index.html'
      )
    );

  }
);

app.get(
  '/index.html',
  (req, res) => {

    res.sendFile(
      path.join(
        root,
        'index.html'
      )
    );

  }
);

app.get(
  '/bhavik-story.html',
  (req, res) => {

    res.sendFile(
      path.join(
        root,
        'bhavik-story.html'
      )
    );

  }
);

app.get(
  '/story.html',
  (req, res) => {

    res.sendFile(
      path.join(
        root,
        'story.html'
      )
    );

  }
);


// =====================================================
// TEST PAGE
// =====================================================

app.get(
  '/test',
  (req, res) => {

    res.send(`
      <!doctype html>

      <html>

      <head>

        <meta charset="utf-8">

        <meta
          name="viewport"
          content="width=device-width,initial-scale=1"
        >

        <title>
          KidsImagination Test
        </title>

      </head>

      <body style="
        font-family:Arial;
        padding:40px;
        background:#fffaf0;
        color:#30264d;
      ">

        <h1>
          KidsImagination is working ✅
        </h1>

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

  }
);


// =====================================================
// FILE UPLOAD
// =====================================================

const upload =
  multer({

    dest: uploads,

    limits: {
      fileSize:
        10 * 1024 * 1024
    }

  });


app.post(
  '/api/upload-photo',
  upload.single('photo'),
  (req, res) => {

    console.log(
      'PHOTO UPLOAD REQUEST'
    );

    if (!req.file) {

      return res
        .status(400)
        .json({
          error:
            'Photo required'
        });

    }

    console.log(
      'PHOTO UPLOADED:',
      req.file.filename
    );

    res.json({

      photoId:
        req.file.filename

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

        return res
          .status(503)
          .json({
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

        return res
          .status(400)
          .json({
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

        return res
          .status(400)
          .json({
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

          currency:
            'INR',

          receipt:
            'KI' +
            Date.now(),

          payment_capture:
            1

        });

      orders[order.id] = {

        id:
          order.id,

        status:
          'created',

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

      res
        .status(500)
        .json({
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

        return res
          .status(404)
          .json({
            error:
              'Order not found'
          });

      }

      if (
        order.id !==
        razorpay_order_id
      ) {

        return res
          .status(400)
          .json({
            error:
              'Order ID mismatch'
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
        expectedSignature !==
          razorpay_signature
      ) {

        console.error(
          'PAYMENT SIGNATURE FAILED'
        );

        return res
          .status(400)
          .json({
            error:
              'Payment verification failed'
          });

      }

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

      generate(
        order.id
      )
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

        ok:
          true,

        orderId:
          order.id

      });

    } catch (error) {

      console.error(
        'PAYMENT VERIFICATION ERROR:',
        error
      );

      res
        .status(500)
        .json({
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

      return res
        .status(404)
        .json({
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

      /*
       * IMPORTANT:
       * There is intentionally NO
       * separate audiobook URL.
       *
       * Each page contains its own
       * audioUrl.
       */

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

  if (
    !process.env.OPENAI_API_KEY
  ) {

    throw new Error(
      'OPENAI_API_KEY missing'
    );

  }

  const response =
    await fetch(
      'https://api.openai.com/v1/' +
        endpoint,
      {

        method:
          'POST',

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
      errorText.slice(
        0,
        1000
      )
    );

  }

  return response;

}


// =====================================================
// CREATE CONNECTED STORY
// =====================================================

async function makeStory(
  data
) {

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

IMPORTANT STORY STYLE:

Create ONE COMPLETE CONNECTED STORY.

The six pages must feel like six parts of the SAME story.

Do NOT create six unrelated mini-stories.

Each page must naturally continue from the previous page.

The final page must resolve the adventure and give the story a warm, happy ending.

Create exactly 6 story pages.

The child is the main character throughout the entire story.

Use very simple vocabulary suitable for ages 1–5.

Each page must contain only 1–3 short sentences.

Every page must have a clear action that can be shown in the illustration.

STORY STRUCTURE:

Page 1:
Introduce the child, setting and beginning of the adventure.

Page 2:
The child discovers something interesting or receives a small invitation or challenge.

Page 3:
The child begins the adventure and meets a friendly character or discovers something special.

Page 4:
The adventure continues with a small age-appropriate problem or surprise.

Page 5:
The child solves the problem through kindness, curiosity, teamwork or imagination.

Page 6:
The adventure ends happily and connects back to the beginning.

Do not create scary, violent, dangerous or sad situations.

Keep the story imaginative, colorful, warm and emotionally positive.

CHARACTER:

The uploaded child photo will be used as the visual identity reference.

The same uploaded child should remain the central character throughout all six illustrations.

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

Do not turn the child into a different child from page to page.

VISUAL STORY CONTINUITY:

Each illustration must visually continue the previous page.

Keep important locations, objects and friendly characters consistent when they return.

The child's clothing should remain logically consistent unless the story specifically requires a change.

IMAGE PROMPTS:

Each imagePrompt must describe:

- child's pose
- facial expression
- clothing
- environment
- important objects
- other characters
- exact action taking place
- visual connection to the previous page
- colorful children's picture-book illustration style

IMPORTANT:

The illustration itself must NOT contain written text.

Do not put:

- words
- letters
- captions
- subtitles
- logos
- watermarks

The story text will be added separately by the website.

RETURN ONLY VALID JSON.

Use exactly this structure:

{
  "title": "Story title",
  "pages": [
    {
      "title": "Internal page title",
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
            role:
              'system',

            content:
              'You create warm, connected personalized childrens picture books. Always return valid JSON only.'
          },

          {
            role:
              'user',

            content:
              prompt
          }

        ],

        temperature:
          0.8,

        response_format: {
          type:
            'json_object'
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

  if (
    !fs.existsSync(photo)
  ) {

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

The child in the illustration must remain the same child across every page of THIS customer's book.

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

Keep visual continuity with the previous story pages.

Create a polished colorful children's picture-book illustration.

The illustration must contain:

NO written text
NO letters
NO captions
NO logos
NO watermark

The story text will be added separately.
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
        fs.readFileSync(
          photo
        )
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
// CREATE ONE PAGE NARRATION
// =====================================================

async function makeAudio(
  text,
  pageNumber
) {

  console.log(
    `OPENAI AUDIO REQUEST STARTING FOR PAGE ${pageNumber}`
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
    `OPENAI AUDIO CREATED FOR PAGE ${pageNumber}`
  );

  return Buffer.from(
    await r.arrayBuffer()
  );

}


// =====================================================
// ADD STORY TEXT WITH TRANSLUCENT CLOUD BACKGROUND
// =====================================================

async function addStoryTextToImage(
  imageBuffer,
  storyText,
  pageNumber
) {

  console.log(
    `ADDING CLOUD STORY TEXT TO IMAGE ${pageNumber}...`
  );

  const width =
    1024;

  const height =
    1024;


  // ===================================================
  // ESCAPE XML
  // ===================================================

  function escapeXml(
    text
  ) {

    return String(
      text
    )
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      )
      .replace(
        /"/g,
        '&quot;'
      )
      .replace(
        /'/g,
        '&apos;'
      );

  }


  // ===================================================
  // WRAP TEXT
  // ===================================================

  function wrapText(
    text,
    maxChars
  ) {

    const words =
      String(text)
        .trim()
        .split(/\s+/);

    const lines = [];

    let line = '';

    for (
      const word of words
    ) {

      const test =
        line
          ? line +
            ' ' +
            word
          : word;

      if (
        test.length >
        maxChars
      ) {

        if (line) {
          lines.push(
            line
          );
        }

        line =
          word;

      } else {

        line =
          test;

      }

    }

    if (line) {
      lines.push(
        line
      );
    }

    return lines;

  }


  // ===================================================
  // TEXT SIZE
  // ===================================================

  let fontSize =
    42;

  let lineHeight =
    52;

  let lines =
    wrapText(
      storyText,
      38
    );

  if (
    lines.length >= 6
  ) {

    fontSize =
      36;

    lineHeight =
      45;

    lines =
      wrapText(
        storyText,
        43
      );

  }

  if (
    lines.length >= 8
  ) {

    fontSize =
      32;

    lineHeight =
      40;

    lines =
      wrapText(
        storyText,
        48
      );

  }


  // ===================================================
  // CLOUD SIZE
  // ===================================================

  const verticalPadding =
    42;

  const textHeight =
    lines.length *
    lineHeight;

  const cloudHeight =
    textHeight +
    verticalPadding * 2;

  const maxCloudHeight =
    410;

  const finalCloudHeight =
    Math.min(
      cloudHeight,
      maxCloudHeight
    );

  const cloudX =
    35;

  const cloudWidth =
    954;

  const cloudY =
    28;


  // ===================================================
  // TEXT POSITION
  // ===================================================

  const actualTextHeight =
    lines.length *
    lineHeight;

  const startY =
    cloudY +
    (
      finalCloudHeight -
      actualTextHeight
    ) / 2 +
    fontSize *
      0.78;


  // ===================================================
  // TEXT SVG
  // ===================================================

  const svgText =
    lines
      .map(
        (
          line,
          index
        ) => {

          const y =
            startY +
            index *
              lineHeight;

          return `
            <text
              x="512"
              y="${y}"
              text-anchor="middle"
              font-family="Arial Rounded MT Bold, Arial, Helvetica, sans-serif"
              font-size="${fontSize}px"
              font-weight="800"
              fill="#21145f"
              stroke="#ffffff"
              stroke-width="1"
              paint-order="stroke"
            >
              ${escapeXml(
                line
              )}
            </text>
          `;

        }
      )
      .join('');


  // ===================================================
  // CLOUD
  // ===================================================

  const cloudBottom =
    cloudY +
    finalCloudHeight;

  const svg = `
    <svg
      width="${width}"
      height="${height}"
      viewBox="0 0 ${width} ${height}"
      xmlns="http://www.w3.org/2000/svg"
    >

      <defs>

        <filter
          id="cloudShadow"
          x="-20%"
          y="-20%"
          width="140%"
          height="150%"
        >

          <feDropShadow
            dx="0"
            dy="5"
            stdDeviation="8"
            flood-color="#000000"
            flood-opacity="0.22"
          />

        </filter>

      </defs>


      <g
        filter="url(#cloudShadow)"
      >

        <rect
          x="${cloudX + 45}"
          y="${cloudY + 25}"
          width="${cloudWidth - 90}"
          height="${Math.max(
            80,
            finalCloudHeight - 50
          )}"
          rx="70"
          fill="#ffffff"
          fill-opacity="0.88"
        />


        <circle
          cx="150"
          cy="${cloudY + 45}"
          r="58"
          fill="#ffffff"
          fill-opacity="0.88"
        />

        <circle
          cx="245"
          cy="${cloudY + 28}"
          r="72"
          fill="#ffffff"
          fill-opacity="0.88"
        />

        <circle
          cx="350"
          cy="${cloudY + 20}"
          r="62"
          fill="#ffffff"
          fill-opacity="0.88"
        />

        <circle
          cx="455"
          cy="${cloudY + 35}"
          r="78"
          fill="#ffffff"
          fill-opacity="0.88"
        />

        <circle
          cx="565"
          cy="${cloudY + 25}"
          r="68"
          fill="#ffffff"
          fill-opacity="0.88"
        />

        <circle
          cx="680"
          cy="${cloudY + 32}"
          r="76"
          fill="#ffffff"
          fill-opacity="0.88"
        />

        <circle
          cx="790"
          cy="${cloudY + 22}"
          r="65"
          fill="#ffffff"
          fill-opacity="0.88"
        />

        <circle
          cx="885"
          cy="${cloudY + 45}"
          r="58"
          fill="#ffffff"
          fill-opacity="0.88"
        />


        <circle
          cx="145"
          cy="${cloudBottom - 28}"
          r="42"
          fill="#ffffff"
          fill-opacity="0.88"
        />

        <circle
          cx="880"
          cy="${cloudBottom - 28}"
          r="42"
          fill="#ffffff"
          fill-opacity="0.88"
        />

      </g>


      ${svgText}

    </svg>
  `;


  // ===================================================
  // COMPOSITE
  // ===================================================

  const finalImage =
    await sharp(
      imageBuffer
    )
      .composite([
        {
          input:
            Buffer.from(
              svg
            ),

          top:
            0,

          left:
            0

        }
      ])
      .png()
      .toBuffer();

  console.log(
    `CLOUD STORY TEXT ADDED TO IMAGE ${pageNumber}`
  );

  return finalImage;

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
    (
      resolve,
      reject
    ) => {

      const f =
        path.join(
          books,
          id + '.pdf'
        );

      const d =
        new PDFDocument({

          size:
            'A5',

          margin:
            0

        });

      const w =
        fs.createWriteStream(
          f
        );


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


      // =================================================
      // COVER
      // =================================================

      d.rect(
        0,
        0,
        d.page.width,
        d.page.height
      )
        .fill(
          '#fff8f0'
        );


      d.fontSize(
        34
      )
        .fillColor(
          '#3d315d'
        )
        .font(
          'Helvetica-Bold'
        )
        .text(
          st.title,
          40,
          100,
          {
            width:
              d.page.width -
              80,

            align:
              'center'
          }
        );


      d.fontSize(
        16
      )
        .fillColor(
          '#777777'
        )
        .font(
          'Helvetica'
        )
        .text(
          'A personalized story created especially for your little one ✨',
          45,
          165,
          {
            width:
              d.page.width -
              90,

            align:
              'center'
          }
        );


      // =================================================
      // STORY PAGES
      // =================================================

      st.pages.forEach(
        (
          p,
          i
        ) => {

          d.addPage({
            size:
              'A5',

            margin:
              0
          });


          const pageWidth =
            d.page.width;

          const pageHeight =
            d.page.height;


          d.image(
            imgs[i],
            0,
            0,
            {
              cover: [
                pageWidth,
                pageHeight
              ],

              align:
                'center',

              valign:
                'center'
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


  if (
    !process.env.OPENAI_API_KEY
  ) {

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


  // ===================================================
  // CREATE STORY
  // ===================================================

  console.log(
    'CREATING CONNECTED STORY WITH OPENAI...'
  );


  const st =
    await makeStory(
      o.data
    );


  console.log(
    'STORY CREATED:',
    st.title
  );


  // ===================================================
  // CHILD PHOTO
  // ===================================================

  const photo =
    path.join(
      uploads,
      o.data.photoId
    );


  if (
    !fs.existsSync(
      photo
    )
  ) {

    throw new Error(
      'Child photo file not found: ' +
      photo
    );

  }


  const imgs = [];

  const pages = [];


  // ===================================================
  // CREATE SIX PAGES
  // ===================================================

  for (
    let i = 0;
    i < st.pages.length;
    i++
  ) {

    const pageNumber =
      i + 1;


    console.log(
      `CREATING PAGE ${pageNumber} OF ${st.pages.length}...`
    );


    // -------------------------------------------------
    // ILLUSTRATION
    // -------------------------------------------------

    const b =
      await makeImage(
        st.pages[i].imagePrompt,
        photo
      );


    // -------------------------------------------------
    // STORY TEXT ON ILLUSTRATION
    // -------------------------------------------------

    const finalImage =
      await addStoryTextToImage(
        b,
        st.pages[i].text,
        pageNumber
      );


    const imageFile =
      path.join(
        books,
        `${id}-${pageNumber}.png`
      );


    fs.writeFileSync(
      imageFile,
      finalImage
    );


    console.log(
      `PAGE ${pageNumber} IMAGE CREATED`
    );


    // -------------------------------------------------
    // PAGE-SPECIFIC NARRATION
    // -------------------------------------------------

    console.log(
      `CREATING NARRATION FOR PAGE ${pageNumber}...`
    );


    const audioBuffer =
      await makeAudio(
        st.pages[i].text,
        pageNumber
      );


    const audioFile =
      path.join(
        books,
        `${id}-page-${pageNumber}.mp3`
      );


    fs.writeFileSync(
      audioFile,
      audioBuffer
    );


    const audioUrl =
      `/books/${id}-page-${pageNumber}.mp3`;


    console.log(
      `PAGE ${pageNumber} AUDIO CREATED:`,
      audioUrl
    );


    // -------------------------------------------------
    // SAVE PAGE DATA
    // -------------------------------------------------

    pages.push({

      ...st.pages[i],

      imageUrl:
        `/books/${id}-${pageNumber}.png`,

      audioUrl

    });


    o.pages =
      pages;

    o.title =
      st.title;


    save();

  }


  console.log(
    'ALL 6 IMAGES AND 6 PAGE NARRATIONS CREATED'
  );


  // ===================================================
  // CREATE PDF
  // ===================================================

  console.log(
    'CREATING PDF...'
  );


  o.pdfUrl =
    await makePdf(
      id,
      st,
      imgs.length === 0
        ? pages.map(
            p =>
              path.join(
                books,
                path.basename(
                  p.imageUrl
                )
              )
          )
        : imgs
    );


  console.log(
    'PDF CREATED:',
    o.pdfUrl
  );


  // ===================================================
  // IMPORTANT:
  // NO SEPARATE AUDIOBOOK IS CREATED.
  //
  // Audio exists only as individual page
  // narration files referenced by each page.
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
    'PDF:',
    o.pdfUrl
  );

  console.log(
    '6 PAGE NARRATIONS READY'
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
      Object.keys(
        orders
      ).length
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
