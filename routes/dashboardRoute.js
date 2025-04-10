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
        // console.log('Two');
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
        var header = "Provide me a question based on any one topic from the resume data(Only provide the question)\n ";
        var prompt = header+pdfText;
        var result = await model.generateContent(prompt);
        var response = await result.response;
        question = response.text();
        // console.log('Three');
        
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

router.post('/skill', dashboardCtrl.registerSkill);

router.post('/search', dashboardCtrl.searchSkill);

module.exports = router;