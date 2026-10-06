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

[data, uploads, books].forEach((dir) => {
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

// =====================================================
// EXPRESS
// =====================================================

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
      path.basename(req.params.filename);

    if (
      !/\.(png|jpg|jpeg)$/i.test(filename)
    ) {
      return res.status(404).end();
    }

    const filePath =
      path.join(root, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).end();
    }

    res.sendFile(filePath);
  }
);

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
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KidsImagination Test</title>

<style>
body{
  margin:0;
  padding:30px;
  font-family:Arial,sans-serif;
  background:#fff8f0;
  color:#30264d;
}

.container{
  max-width:800px;
  margin:auto;
  background:white;
  padding:30px;
  border-radius:24px;
  box-shadow:0 10px 40px rgba(0,0,0,.08);
}

h1{
  margin-top:0;
}

.card{
  margin-top:20px;
  padding:20px;
  border-radius:18px;
  background:#f7f1ff;
}

a{
  display:inline-block;
  margin-top:10px;
  color:#6d42d8;
  font-weight:bold;
}
</style>
</head>

<body>

<div class="container">

<h1>KidsImagination is working ✅</h1>

<p>
The Render server is running correctly.
</p>

<div class="card">

<h3>Website</h3>

<a href="/">
Open KidsImagination homepage
</a>

</div>

<div class="card">

<h3>Bhavik Story</h3>

<a href="/bhavik-story.html">
Open Bhavik's story
</a>

</div>

<div class="card">

<h3>Story Viewer</h3>

<a href="/story.html">
Open story viewer
</a>

</div>

<p>
Server supports:
</p>

<ul>
<li>6 connected story pages</li>
<li>6 illustrations</li>
<li>6 individual page narrations</li>
<li>PDF download</li>
<li>Razorpay payments</li>
</ul>

</div>

</body>
</html>
`);
});

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

      const input =
        req.body || {};

      if (
        !input.childName ||
        !input.age ||
        !input.theme
      ) {
        return res
          .status(400)
          .json({
            error:
              'Child name, age and theme are required'
          });
      }

      const amount =
        Number(input.amount);

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

        data:
          input

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

      const lookupId =
        orderId ||
        razorpay_order_id;

      console.log(
        'PAYMENT DATA:',
        {
          razorpay_order_id,
          razorpay_payment_id,
          orderId
        }
      );

      const order =
        orders[lookupId];

      if (!order) {

        console.error(
          'ORDER NOT FOUND:',
          lookupId
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

      generate(
        order.id
      )
        .then(() => {

          console.log(
            'STORY GENERATION FINISHED:',
            order.id
          );

        })
        .catch((error) => {

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
        order.pages || [],

      pdfUrl:
        order.pdfUrl || null,

      error:
        order.error || null
    });
  }
);

// =====================================================
// OPENAI HELPER
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
        1500
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

IMPORTANT:

Create ONE COMPLETE CONNECTED STORY.

The six pages are six sequential parts of the SAME adventure.

Do NOT create six unrelated stories.

Every page must continue naturally from the previous page.

The child is the main character throughout.

Create exactly 6 pages.

Use simple vocabulary suitable for ages 1–5.

Each page should contain 1–3 short sentences.

Every page must contain a clear action that can be illustrated.

STORY STRUCTURE:

Page 1:
Introduce the child, setting and beginning of the adventure.

Page 2:
The child discovers something interesting or receives an invitation or challenge.

Page 3:
The child continues the adventure and meets a friendly character or discovers something special.

Page 4:
A small age-appropriate problem or surprise appears.

Page 5:
The child solves the problem through kindness, curiosity, teamwork or imagination.

Page 6:
The adventure ends happily and connects back to the beginning.

Keep everything:
- warm
- colorful
- playful
- positive
- age appropriate
- imaginative

Do not create:
- violence
- scary scenes
- dangerous situations
- sad endings

CHARACTER CONSISTENCY:

The uploaded child photo will be used as the visual identity reference.

The same child must remain the main character throughout all six illustrations.

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

Do not turn the child into another child.

VISUAL CONTINUITY:

The illustrations must feel like pages from the same picture book.

Keep locations, objects and supporting characters consistent when they return.

Keep clothing logically consistent.

IMAGE PROMPTS:

Each imagePrompt must describe:

- child's pose
- facial expression
- clothing
- environment
- important objects
- supporting characters
- exact action
- visual connection to previous page
- colorful children's picture-book illustration style

The illustration must NOT contain:
- text
- letters
- captions
- subtitles
- logos
- watermarks

Return ONLY valid JSON.

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

  const response =
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
              'You create connected personalized childrens picture books. Return valid JSON only.'
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

  const result =
    await response.json();

  const outputText =
    result
      .choices?.[0]
      ?.message?.content;

  if (!outputText) {

    console.error(
      'OPENAI STORY RESPONSE:',
      JSON.stringify(
        result,
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

    throw new Error(
      'OpenAI returned an invalid 6-page story'
    );
  }

  for (
    const page of story.pages
  ) {

    if (
      !page.title ||
      !page.text ||
      !page.imagePrompt
    ) {

      throw new Error(
        'One or more story pages are incomplete'
      );
    }
  }

  console.log(
    'STORY CREATED:',
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

  const form =
    new FormData();

  form.append(
    'model',
    process.env.OPENAI_IMAGE_MODEL ||
      'gpt-image-2'
  );

  form.append(
    'prompt',

    prompt +

    `

IMPORTANT CHARACTER CONSISTENCY:

Use the uploaded child photo as the primary identity reference.

The child must remain the same child throughout this customer's six-page book.

Preserve:
- recognizable face
- face shape
- eyes
- nose
- mouth
- hairstyle
- hair color
- skin tone
- age appearance
- facial proportions

Do not create a different child.

Do not make the child older or younger.

Do not change the child's facial structure.

Create a polished colorful children's picture-book illustration.

The illustration must contain:

NO written text.
NO letters.
NO captions.
NO subtitles.
NO logos.
NO watermark.

The story text is added separately by the website.
`
  );

  form.append(
    'size',
    '1024x1024'
  );

  form.append(
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

  const response =
    await ai(
      'images/edits',
      form
    );

  const result =
    await response.json();

  if (
    !result.data ||
    !result.data[0] ||
    !result.data[0].b64_json
  ) {

    console.error(
      'IMAGE API RESPONSE:',
      JSON.stringify(
        result,
        null,
        2
      )
    );

    throw new Error(
      'OpenAI image generation returned no image'
    );
  }

  return Buffer.from(
    result.data[0].b64_json,
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
    `CREATING PAGE ${pageNumber} NARRATION`
  );

  const response =
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

  const arrayBuffer =
    await response.arrayBuffer();

  console.log(
    `PAGE ${pageNumber} NARRATION CREATED`
  );

  return Buffer.from(
    arrayBuffer
  );
}

// =====================================================
// ADD STORY TEXT TO ILLUSTRATION
// =====================================================

async function addStoryTextToImage(
  imageBuffer,
  storyText,
  pageNumber
) {

  console.log(
    `ADDING STORY TEXT TO PAGE ${pageNumber}`
  );

  const width =
    1024;

  const height =
    1024;

  function escapeXml(text) {

    return String(text)
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
${escapeXml(line)}
</text>
`;

        }
      )
      .join('');

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

<g filter="url(#cloudShadow)">

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

  return await sharp(
    imageBuffer
  )
    .composite([
      {
        input:
          Buffer.from(svg),

        top:
          0,

        left:
          0
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
  imageFiles
) {

  return new Promise(
    (
      resolve,
      reject
    ) => {

      const filePath =
        path.join(
          books,
          id + '.pdf'
        );

      const doc =
        new PDFDocument({

          size:
            'A5',

          margin:
            0
        });

      const stream =
        fs.createWriteStream(
          filePath
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
        .fill(
          '#fff8f0'
        );

      doc
        .fontSize(34)
        .fillColor('#3d315d')
        .font('Helvetica-Bold')
        .text(
          st.title,
          40,
          100,
          {
            width:
              doc.page.width -
              80,

            align:
              'center'
          }
        );

      doc
        .fontSize(16)
        .fillColor('#777777')
        .font('Helvetica')
        .text(
          'A personalized story created especially for your little one',
          45,
          165,
          {
            width:
              doc.page.width -
              90,

            align:
              'center'
          }
        );

      // =================================================
      // SIX STORY PAGES
      // =================================================

      imageFiles.forEach(
        (imageFile) => {

          doc.addPage({
            size:
              'A5',

            margin:
              0
          });

          doc.image(
            imageFile,
            0,
            0,
            {
              cover: [
                doc.page.width,
                doc.page.height
              ],

              align:
                'center',

              valign:
                'center'
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

  const order =
    orders[id];

  if (!order) {

    throw new Error(
      'Order not found: ' +
      id
    );
  }

  // ===================================================
  // STORY
  // ===================================================

  const story =
    await makeStory(
      order.data
    );

  console.log(
    'STORY CREATED:',
    story.title
  );

  // ===================================================
  // PHOTO
  // ===================================================

  const photo =
    path.join(
      uploads,
      order.data.photoId
    );

  if (
    !fs.existsSync(photo)
  ) {

    throw new Error(
      'Child photo file not found: ' +
      photo
    );
  }

  const imageFiles = [];
  const pages = [];

  // ===================================================
  // CREATE 6 PAGES
  // ===================================================

  for (
    let i = 0;
    i < story.pages.length;
    i++
  ) {

    const pageNumber =
      i + 1;

    const storyPage =
      story.pages[i];

    console.log(
      `======================================`
    );

    console.log(
      `CREATING PAGE ${pageNumber}/6`
    );

    console.log(
      `======================================`
    );

    // =================================================
    // IMAGE
    // =================================================

    const rawImage =
      await makeImage(
        storyPage.imagePrompt,
        photo
      );

    // =================================================
    // STORY TEXT
    // =================================================

    const finalImage =
      await addStoryTextToImage(
        rawImage,
        storyPage.text,
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

    // IMPORTANT:
    // Add every generated image to the PDF list.
    imageFiles.push(
      imageFile
    );

    const imageUrl =
      `/books/${id}-${pageNumber}.png`;

    console.log(
      `PAGE ${pageNumber} IMAGE READY:`,
      imageUrl
    );

    // =================================================
    // INDIVIDUAL PAGE NARRATION
    // =================================================

    const audioBuffer =
      await makeAudio(
        storyPage.text,
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
      `PAGE ${pageNumber} AUDIO READY:`,
      audioUrl
    );

    // =================================================
    // SAVE PAGE
    // =================================================

    pages.push({

      title:
        storyPage.title,

      text:
        storyPage.text,

      imagePrompt:
        storyPage.imagePrompt,

      imageUrl,

      audioUrl
    });

    order.title =
      story.title;

    order.pages =
      pages;

    save();
  }

  // ===================================================
  // ALL SIX PAGES CREATED
  // ===================================================

  console.log(
    '======================================'
  );

  console.log(
    'ALL 6 ILLUSTRATIONS CREATED'
  );

  console.log(
    'ALL 6 PAGE NARRATIONS CREATED'
  );

  console.log(
    '======================================'
  );

  // ===================================================
  // CREATE ONE PDF
  // ===================================================

  console.log(
    'CREATING PDF...'
  );

  order.pdfUrl =
    await makePdf(
      id,
      story,
      imageFiles
    );

  console.log(
    'PDF CREATED:',
    order.pdfUrl
  );

  // ===================================================
  // NO SEPARATE AUDIOBOOK
  // ===================================================

  /*
   * IMPORTANT:
   *
   * We intentionally DO NOT create:
   *
   * order.audioUrl
   *
   * and we DO NOT create a single audiobook.mp3.
   *
   * Instead:
   *
   * Page 1 -> page-1.mp3
   * Page 2 -> page-2.mp3
   * Page 3 -> page-3.mp3
   * Page 4 -> page-4.mp3
   * Page 5 -> page-5.mp3
   * Page 6 -> page-6.mp3
   *
   * story.html will place the Listen button
   * on each corresponding illustration.
   */

  order.status =
    'ready';

  order.error =
    null;

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
    order.pdfUrl
  );

  console.log(
    '6 INDIVIDUAL PAGE NARRATIONS READY'
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

    // =================================================
    // RESUME INTERRUPTED PAID STORIES
    // =================================================

    Object.values(
      orders
    ).forEach(
      (order) => {

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
              (error) => {

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
