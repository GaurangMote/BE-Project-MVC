const express = require('express');
const router = express.Router();
const dashboardCtrl = require('../controllers/dashboardCtrl');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;  
const path = require('path');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
var question = "";
let score = 0;
let count = 0;
var pdfText = "";
var jobText = "";
var location = "";

//Routes
router.get('/',dashboardCtrl.dashboard);

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')  // Specify the directory where uploaded files will be stored
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname)) // Generate unique filename
    }
});

const upload = multer({ storage: storage });

router.post('/', upload.single('resume'), async (req, res) => {
    try {
        // console.log('Hi');
        const filePath = path.join(__dirname, '../uploads',req.file.filename);
        const dataBuffer = await fs.readFile(filePath);
        const pdfData = await pdfParse(dataBuffer);

        pdfText = pdfData.text;

        // await axios.post('http://10.10.14.172:5002/question', {
        //     resume: pdfText,
        //     username : "Anish"
        // });

        // var response = await axios.get('http://10.10.14.172:5002/question/Anish/56');

        // console.log('Two');
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
        var header = "Provide me a question based on any one topic from the resume data(Only provide the question)\n ";
        var prompt = header+pdfText;
        var result = await model.generateContent(prompt);
        var response = await result.response;
        question = response.text();
        // console.log('Three');

        // const apiData = response.data.data;

        // Do something with the retrieved data
        // console.log('Received data:', apiData);

        const locals = {
            title : 'Get Questions',
            description: 'Interview',
        };

        res.render('dashboard/questions', {
            locals,
            question,
            layout: '../views/layouts/dashboard'
        });
    } 
    catch (error) {
        console.error('Error processing upload : ', error);
        res.status(500).send('Error processing upload');    
    }
});


router.post('/evaluate', async (req, res) => {
    try {   
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});

        var userAnswer = req.body.answer;
        var evaluate = "Evaluate the following question and answer and provide a score out of 10 (only provide the score)\n"
        var prompt = evaluate+question+"\n"+userAnswer;
        var result = await model.generateContent(prompt);
        var response = await result.response;
        var scoreText = response.text();

        score = parseFloat(scoreText);
        console.log(score);

        let followUpPrompt = "";
        
        if (score >= 5 && count<2) {
            count = count+1;
            followUpPrompt = `Based on this question: "${question}", generate a slightly tougher follow-up question on the same topic.`;
        } else {
            count = 0;
            followUpPrompt = `Generate a new question on a different topic than "${question}" from the resume data - "${pdfText}".`;
        }

        var followUpResult = await model.generateContent(followUpPrompt);
        var followUpResponse = await followUpResult.response;
        question = followUpResponse.text();

        // if (!req.session) {
        //     req.session = {}; // in rare cases where session middleware fails
        // }
        
        // if (!req.session.interaction) {
        //     req.session.interaction = [];
        // }

        // const interaction = req.session.interaction;
        // interaction[interaction.length - 1].question = question;
        // interaction[interaction.length - 1].answer = userAnswer;
        // interaction[interaction.length - 1].Score = score;

        // Push new question for next round
        // interaction.push({
        //     question: question,
        //     answer: userAnswer,
        //     Score: score
        // });

        // req.session.interaction = interaction;

        const locals = {
            title : 'Get Questions',
            description: 'Interview',
        };

        res.render('dashboard/questions', {
            locals,
            question,
            layout: '../views/layouts/dashboard'
        });
    } catch (error) {
        console.error('Error processing evaluation:', error);
        res.status(500).send('Error evaluating answer');
    }
});

router.get('/report', (req, res) => {
    const interactions = req.session.interaction || [];

    res.render('dashboard/report', {
        interactions,
        layout: '../views/layouts/dashboard',
        title: 'Interview Report'
    });
});

router.post('/jobs', async (req, res) => {
    try {
        location = req.body.location;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const jobPrompt = `Given the resume below:\n${pdfText}\nAnd the preferred job location: "${location}", suggest 5 job roles in companies in this format\n Web Developer at Dreams International
        Location: Swargate, Pune\n
        Experience: 1-2 years\n
        Salary: ₹20,000-₹25,000/month \nsuitable for the candidate. Just provide the job details and don't generate anything else.`;

        const jobResult = await model.generateContent(jobPrompt);
        const jobResponse = await jobResult.response;
        jobs = jobResponse.text();

        const locals = {
            title: 'Job Suggestions',
            description: 'Resume + Location based Jobs'
        };

        res.render('dashboard/questions', {
            locals,
            question,
            jobs,
            location,
            layout: '../views/layouts/dashboard'
        });

    } catch (error) {
        console.error('Error generating job suggestions:', error);
        res.status(500).send('Failed to generate job suggestions.');
    }
});

router.post('/skill', dashboardCtrl.registerSkill);

router.post('/search', dashboardCtrl.searchSkill);

module.exports = router;