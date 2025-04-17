const express = require('express');
const router = express.Router();
const dashboardCtrl = require('../controllers/dashboardCtrl');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const PDFDocument = require('pdfkit');
const fs = require('fs').promises;
const fss = require('fs');
const path = require('path');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.API_KEY);
var question = "";
let score = 0;
let count = 0;
var pdfText = "";
var location = "";
var jobText= "";
var jobs = "";

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

router.post('/', upload.fields([{ name: 'resume' }, { name: 'job-description' }]), async (req, res) => {
    try {
        // console.log('Hi');
        const resumeFile = req.files['resume'][0];
        const jdFile = req.files['job-description'] ? req.files['job-description'][0] : null;

        const resumePath = path.join(__dirname, '../uploads',resumeFile.filename);
        const resumeBuffer = await fs.readFile(resumePath);
        const pdfData = await pdfParse(resumeBuffer);

        pdfText = pdfData.text;

        if (jdFile) {
            const jdPath = path.join(__dirname, '../uploads', jdFile.filename);
            const jdBuffer = await fs.readFile(jdPath);
            const jdData = await pdfParse(jdBuffer);
            jobText = jdData.text;
        }
        // await axios.post('http://10.10.14.172:5002/question', {
        //     resume: pdfText,
        //     username : "Anish"
        // });

        // var response = await axios.get('http://10.10.14.172:5002/question/Anish/56');

        // console.log('Two');
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
        var header = "Provide me a question based on any one topic from the resume data(Only provide the question) or technical skills mentioned in resume and Job Decription\n ";
        var prompt = header+pdfText+"\n"+jobText;
        var result = await model.generateContent(prompt);
        var response = await result.response;
        question = response.text();


        // console.log(jobText);
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
            jobs, 
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

        if (!req.session) {
            req.session = {}; // in rare cases where session middleware fails
        }

        if (!req.session.interactions) {
            req.session.interactions = [];
        }

        req.session.interactions.push({
            questions: question,
            answer: userAnswer,
            score
        });

        console.log(req.session.interactions);
        console.log(req.session.id);

        let followUpPrompt = "";
        
        if (score >= 5 && count<2) {
            count = count+1;
            followUpPrompt = `Based on this question: "${question}", generate a slightly tougher follow-up question on the same topic.`;
        } else {
            count = 0;
            followUpPrompt = `Generate a new question on a different topic than "${question}" from the resume data - "${pdfText}" and also on technical skills mentioned in resume data for job description - "${jobText}".`;
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
            jobs,
            layout: '../views/layouts/dashboard'
        });
    } catch (error) {
        console.error('Error processing evaluation:', error);
        res.status(500).send('Error evaluating answer');
    }
});

router.get('/report', async (req, res) => {
    try {
        // Fallback handling
        console.log('Session ID:', req.sessionID);
        console.log('Session interactions at /report:', req.session.interactions);

        const interactions = req.session.interactions;

        console.log(req.session.interactions);
        console.log(req.session.id);

        // Format interactions into a prompt
        const prompt = `Here is an interview session with questions, answers, and scores. 
        Please provide a summary of the interview and feedback for the candidate, including strengths, weaknesses, and suggestions for improvement.
        ${interactions.map((item, index) => (
            `${index + 1}. Question: ${item.questions}\n   Answer: ${item.answer}\n   Score: ${item.score}/10`
        )).join('\n\n')}`;

        // Send prompt to Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const feedback = response.text();

        // console.log(feedback);

        const doc = new PDFDocument();
        const pdfPath = path.join(__dirname, '../public/reports', `interview_report_${Date.now()}.pdf`);
        const stream = fss.createWriteStream(pdfPath);
        doc.pipe(stream);

        doc.fontSize(18).text('Interview Report', { align: 'center' });
        doc.moveDown();

        interactions.forEach((item, index) => {
            doc.fontSize(12).text(`${index + 1}. Question: ${item.questions}`);
            doc.text(`   Answer: ${item.answer}`);
            doc.text(`   Score: ${item.score}/10`);
            doc.moveDown();
        });

        doc.fontSize(14).text('Feedback:', { underline: true });
        doc.fontSize(12).text(feedback);

        doc.end();

        stream.on('finish', () => {
            res.download(pdfPath, 'interview_report.pdf', (err) => {
                if (err) {
                    console.error('Error sending PDF:', err);
                    res.status(500).send('Error sending PDF');
                } else {
                    console.log('PDF sent successfully');
                }
            });
        });

        //Render 
        // res.render('dashboard/questions', {
        //     interactions,
        //     question,
        //     jobs,
        //     feedback,
        //     layout: '../views/layouts/dashboard',
        //     title: 'Interview Report'
        // });
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).send('Error generating interview report');
    }
});

// router.get('/report', async (req, res) => {v   
//     try {   
//         const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});

//         var userAnswer = req.body.answer;
//         var evaluate = "Evaluate the following question and answer and provide a score out of 10 (only provide the score)\n"
//         var prompt = evaluate+question+"\n"+userAnswer;
//         var result = await model.generateContent(prompt);
//         var response = await result.response;
//         var scoreText = response.text();

//         score = parseFloat(scoreText);
//         console.log(score);

//         if (!req.session) {
//             req.session = {}; // in rare cases where session middleware fails
//         }

//         if (!req.session.interactions) {
//             req.session.interactions = [];
//         }

//         req.session.interactions.push({
//             questions: question,
//             answer: userAnswer,
//             score
//         });

//         var followUpResult = await model.generateContent(followUpPrompt);
//         var followUpResponse = await followUpResult.response;
//         question = followUpResponse.text();

//         const locals = {
//             title : 'Get Questions',
//             description: 'Interview',
//         };

//         res.render('dashboard/questions', {
//             locals,
//             question,
//             answer,
//             jobs,
//             layout: '../views/layouts/dashboard'
//         });
//     } catch (error) {
//         console.error('Error processing evaluation:', error);
//         res.status(500).send('Error evaluating answer');
//     }
// });

// router.get('/report', (req, res) => {
//     console.log('SESSION:', req.session);

//     const interactions = req.session.interactions || [];

//     const questions = interactions.map(i => i.question);
//     const answer = interactions.map(i => i.answer);
//     const score = interactions.map(i => i.score);

//     res.render('dashboard/report', {
//         questions,
//         answer,
//         score,
//         layout: '../views/layouts/dashboard',
//         title: 'Interview Report'
//     });
// });

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