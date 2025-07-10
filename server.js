require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');
const curriculumTopics = require('../MathApp/public/curriculum-map.json')


const app = express();
const port = process.env.PORT || 3000;

// Store recent questions (max 20 to improve duplicate detection)
const questionHistory = [];

// Define question types, contexts, and difficulties for variety
const questionTypes = ['word problem', 'equation problem', 'multiple-choice', 'real-world application'];
const contexts = ['in a store', 'during a trip', 'at a zoo', 'in a classroom', 'at a park'];
const difficulties = ['easy', 'medium', 'hard'];

// Fallback problems for specific grades and topics
const fallbackProblems = {
  '10': {
    'geometry': [
      { question: 'What is the area of a triangle with base 6 cm and height 8 cm?', answer: '24 cm²', type: 'geometry' },
      { question: 'Find the circumference of a circle with radius 5 cm (use π ≈ 3.14).', answer: '31.4 cm', type: 'geometry' },
      { question: 'What is the measure of an interior angle of a regular pentagon?', answer: '108 degrees', type: 'geometry' },
      { question: 'A rectangle has a length of 10 cm and a width of 4 cm. What is its perimeter?', answer: '28 cm', type: 'geometry' },
      { question: 'What is the area of a circle with diameter 10 cm (use π ≈ 3.14)?', answer: '78.5 cm²', type: 'geometry' },
      { question: 'Find the length of the hypotenuse of a right triangle with legs 3 cm and 4 cm.', answer: '5 cm', type: 'geometry' },
      { question: 'What is the sum of the interior angles of a hexagon?', answer: '720 degrees', type: 'geometry' }
    ],
    'functions': [
      { question: 'For the function f(x) = 2x + 3, what is f(4)?', answer: '11', type: 'functions' },
      { question: 'What is the domain of the function f(x) = 1/(x-2)?', answer: 'All real numbers except x = 2', type: 'functions' },
      { question: 'Find the slope of the line given by f(x) = -3x + 5.', answer: '-3', type: 'functions' },
      { question: 'If f(x) = x², what is f(-3)?', answer: '9', type: 'functions' }
    ],
    'trigonometry': [
      { question: 'In a right triangle, if one angle is 30°, what is the sine of that angle?', answer: '0.5', type: 'trigonometry' },
      { question: 'Find the cosine of 60°.', answer: '0.5', type: 'trigonometry' }
    ],
    'quadratic equations': [
      { question: 'Solve the quadratic equation x² - 4x + 4 = 0.', answer: 'x = 2', type: 'quadratic equations' },
      { question: 'What is the vertex of the parabola y = x² + 2x - 3?', answer: '(-1, -4)', type: 'quadratic equations' }
    ]
  }
  // Add other grades as needed
};

// Normalize question for duplicate detection
const normalizeQuestion = (question) => {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .sort()
    .join(' ');
};

// Log all registered routes
const logRoutes = () => {
  console.log('Registered routes:');
  app._router.stack.forEach((layer, index) => {
    if (layer.route) {
      console.log(`Layer ${index}: Path: ${layer.route.path}, Methods: ${Object.keys(layer.route.methods).join(', ')}`);
    } else {
      console.log(`Layer ${index}: ${layer.name || 'Unnamed'} middleware`);
    }
  });
};

// CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    console.log('CORS request from origin:', origin);
    callback(null, true);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());

app.use(express.json());
app.use(express.static('public'));

app.get('/health', (req, res) => {
  console.log('Health check requested');
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve static files (e.g., index.html) from the 'public' directory
app.use(express.static('public'));

// Create a new route to serve the curriculum topics
app.get('/get-curriculum-topics', async (req, res) => {
  res.type('application/json');
  res.send(JSON.stringify(curriculumTopics));
});

app.get('/generate-problem', async (req, res) => {
  console.log('Registering route: /generate-problem');
  const { grade, topic, nonce } = req.query;

  console.log('Request received:', { grade, topic, nonce });

  try {
    const normalizedTopic = topic ? decodeURIComponent(topic).trim().toLowerCase() : '';
    const normalizedGrade = grade ? grade.toString() : '';

    if (!normalizedGrade || !normalizedTopic) {
      console.error('Missing grade or topic:', { normalizedGrade, normalizedTopic });
      return res.status(400).json({ error: `Missing grade (${normalizedGrade}) or topic (${normalizedTopic})` });
    }

    if (!curriculumTopics[normalizedGrade] || !curriculumTopics[normalizedGrade].map(t => t.toLowerCase()).includes(normalizedTopic)) {
      console.error('Invalid grade or topic:', { normalizedGrade, normalizedTopic });
      return res.status(400).json({ error: `Invalid grade (${normalizedGrade}) or topic (${normalizedTopic})` });
    }

    if (!process.env.XAI_API_KEY) {
      console.error('XAI_API_KEY is not set');
      return res.status(500).json({ error: 'Server configuration error: Missing API key' });
    }

    console.log('Making xAI API call for:', { normalizedGrade, normalizedTopic });

    const generateProblem = async (retryCount = 0, maxRetries = 7) => {
      if (retryCount >= maxRetries) {
        console.error('Max retries reached for:', { normalizedGrade, normalizedTopic });
        const fallback = fallbackProblems[normalizedGrade]?.[normalizedTopic] || [
          { question: `Fallback problem for grade ${normalizedGrade} (${normalizedTopic}): Solve a basic problem related to ${normalizedTopic}.`, answer: 'N/A', type: normalizedTopic }
        ];
        const problem = fallback[Math.floor(Math.random() * fallback.length)];
        console.log('Using fallback problem:', problem);
        return res.json(problem);
      }

      const randomType = questionTypes[Math.floor(Math.random() * questionTypes.length)];
      const randomContext = contexts[Math.floor(Math.random() * contexts.length)];
      const randomDifficulty = difficulties[Math.floor(Math.random() * difficulties.length)];
      const prompt = `Generate a unique ${randomType} math problem for grade ${normalizedGrade} on the topic of ${normalizedTopic} in a ${randomContext}. The problem must be appropriate for Grade ${normalizedGrade} students, focusing on ${normalizedTopic} concepts (e.g., triangles, circles, angles for geometry). The problem should be ${randomDifficulty} difficulty. Ensure it differs from previous problems by varying numbers and scenarios. Return the response as a JSON object: {"question": "", "answer": "", "options": []}. For multiple-choice questions, provide exactly 4 options in the "options" array, with the correct answer included. For non-multiple-choice questions, set "options" to an empty array.`;

      console.log(`Generated prompt (retry ${retryCount}):`, prompt);

      try {
        const response = await axios.post(
          'https://api.x.ai/v1/chat/completions',
          {
            model: 'grok-3',
            messages: [
              {
                role: 'user',
                content: prompt
              }
            ],
            max_tokens: 300,
            temperature: 0.9
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('xAI API raw response:', response.data);

        if (!response.data.choices || !response.data.choices[0]?.message?.content) {
          console.error(`Invalid xAI API response (retry ${retryCount + 1}/${maxRetries}):`, response.data);
          setTimeout(() => generateProblem(retryCount + 1, maxRetries), 1000);
          return;
        }

        const content = response.data.choices[0].message.content;
        let problemData;
        try {
          // Validate JSON before parsing
          if (!content.startsWith('{') || !content.endsWith('}')) {
            throw new Error('Response is not valid JSON');
          }
          problemData = JSON.parse(content);
          if (!problemData.question || !problemData.answer) {
            throw new Error('Missing question or answer in parsed response');
          }
        } catch (parseError) {
          console.error(`Error parsing xAI response (retry ${retryCount + 1}/${maxRetries}):`, parseError.message, 'Raw response:', content);
          setTimeout(() => generateProblem(retryCount + 1, maxRetries), 1000);
          return;
        }

        const normalizedQuestion = normalizeQuestion(problemData.question);
        if (questionHistory.includes(normalizedQuestion)) {
          console.log(`Duplicate question detected (retry ${retryCount + 1}/${maxRetries}):`, problemData.question);
          setTimeout(() => generateProblem(retryCount + 1, maxRetries), 1000);
          return;
        }

        questionHistory.push(normalizedQuestion);
        if (questionHistory.length > 20) {
          questionHistory.shift();
        }

        res.set('Cache-Control', 'no-store');
        res.json({ ...problemData, type: normalizedTopic });
      } catch (apiError) {
        console.error('xAI API error:', {
          message: apiError.message,
          status: apiError.response?.status,
          data: apiError.response?.data,
          headers: apiError.response?.headers
        });

        if ([429, 400, 500].includes(apiError.response?.status)) {
          console.log(`API error (status ${apiError.response?.status}), retrying after 1 second (retry ${retryCount + 1}/${maxRetries})...`);
          setTimeout(() => generateProblem(retryCount + 1, maxRetries), 1000);
          return;
        }

        const errorMessage = apiError.response?.data?.error?.message || apiError.response?.data?.error || apiError.message;
        const isModelError = apiError.response?.status === 404 && typeof errorMessage === 'string' && errorMessage.includes('model');
        const isResourceNotFound = apiError.response?.status === 404 && typeof errorMessage === 'string' && errorMessage.includes('resource was not found');

        if (isModelError) {
          return res.status(400).json({
            error: 'Model access error',
            details: 'The specified model (grok-3) is not available. Please check xAI API documentation at https://docs.x.ai/ or contact support with team ID 16956b76-3090-4a12-8ab8-296296a191a3.',
            status: apiError.response.status,
            responseData: apiError.response.data
          });
        }

        if (isResourceNotFound) {
          return res.status(400).json({
            error: 'API endpoint error',
            details: 'The xAI API endpoint was not found. Please verify the endpoint URL in the xAI API documentation at https://docs.x.ai/ or contact support with team ID 16956b76-3090-4a12-8ab8-296296a191a3.',
            status: apiError.response.status,
            responseData: apiError.response.data
          });
        }

        const fallback = fallbackProblems[normalizedGrade]?.[normalizedTopic] || [
          { question: `Fallback problem for grade ${normalizedGrade} (${normalizedTopic}): Solve a basic problem related to ${normalizedTopic}.`, answer: 'N/A', type: normalizedTopic }
        ];
        const problem = fallback[Math.floor(Math.random() * fallback.length)];
        console.log('Using fallback problem due to API error:', problem);
        res.json(problem);
      }
    };

    await generateProblem();
  } catch (error) {
    console.error('General error:', {
      message: error.message,
      stack: error.stack
    });
    const fallback = fallbackProblems[normalizedGrade]?.[normalizedTopic] || [
      { question: `Fallback problem for grade ${normalizedGrade} (${normalizedTopic}): Solve a basic problem related to ${normalizedTopic}.`, answer: 'N/A', type: normalizedTopic }
    ];
    const problem = fallback[Math.floor(Math.random() * fallback.length)];
    console.log('Using fallback problem due to general error:', problem);
    res.json(problem);
  }
});

// Explicit catch-all route
app.all('*', (req, res) => {
  console.log('Unhandled route:', req.originalUrl);
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message, 'Stack:', err.stack);
  const fallback = fallbackProblems[req.query.grade]?.[req.query.topic.toLowerCase()] || [
    { question: `Fallback problem for grade ${req.query.grade || 'unknown'} (${req.query.topic || 'unknown'}): Solve a basic problem.`, answer: 'N/A', type: req.query.topic || 'unknown' }
  ];
  const problem = fallback[Math.floor(Math.random() * fallback.length)];
  console.log('Using fallback problem due to unhandled error:', problem);
  res.status(500).json(problem);
});

logRoutes();

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});