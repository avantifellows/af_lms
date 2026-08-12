# AUTO-GENERATED — DO NOT EDIT BY HAND.
#
# Generated from af_lms src/lib/teacher-feedback-form.ts (version v2)
# by `npm run teacher-feedback:bundle`. Copy this file to
# etl-data-flow/flows/sessionCreator/teacher_feedback_form.py.
#
# The Teacher Feedback (V2) student form, bundled so sessionCreator can build the
# quiz without a CMS link or Google Sheet.
#
# Question and option ORDER here is the order students see. The af_lms report
# matches responses by question text and option label rather than by position, so
# reordering no longer misattributes scores — but renaming a question or an
# option makes older responses unrecognisable to the report, so treat the text as
# the identifier it is.
#
# af_lms pins this file's contents in a unit test, so editing the form there
# without regenerating this file fails CI.

TEACHER_FEEDBACK_FORM_VERSION = "v2"

# Rows shaped for CSVFormQuestion (columns: Theme, Baseline Questions, Question Type, Options, Summary).
TEACHER_FEEDBACK_FORM_ROWS = [
    {
        "Theme": "Planning",
        "Baseline Questions": "Does the teacher start and end the class on time?",
        "Question Type": "single-choice",
        "Options": "The teacher always starts and ends the class on time.\nThe teacher is sometimes late or ends class early.\nThe teacher is often late or ends class noticeably early.",
        "Summary": "no"
    },
    {
        "Theme": "Planning",
        "Baseline Questions": "Does it feel like the teacher has planned the class before coming in?",
        "Question Type": "single-choice",
        "Options": "The teacher comes in with clear topics, notes, examples, and practice problems ready.\nThe teacher is sometimes well-prepared and able to manage the class effectively, but not consistently.\nThe class feels unstructured; the teacher seems unprepared.",
        "Summary": "no"
    },
    {
        "Theme": "Concept",
        "Baseline Questions": "How well does the teacher explain concepts, solve problems or PYQ?",
        "Question Type": "single-choice",
        "Options": "The teacher explains concepts clearly, solves problems or PYQ step by step.\nThe teacher explains some concepts clearly and solves problems sometimes.\nThe teacher gives unclear explanations, rarely focuses on problem solving.",
        "Summary": "no"
    },
    {
        "Theme": "Concept",
        "Baseline Questions": "When students raise doubts, how does the teacher handle them?",
        "Question Type": "single-choice",
        "Options": "The teacher addresses most doubts, explains concepts until students understand, and follows up later during or after class if needed.\nThe teacher answers doubts, but sometimes the explanations are brief or lack patience\nThe teacher discourages doubts, dismisses questions, or makes students feel uncomfortable.",
        "Summary": "no"
    },
    {
        "Theme": "Concept",
        "Baseline Questions": "How clearly does the teacher explain concepts and build from basics to advanced topics?",
        "Question Type": "single-choice",
        "Options": "The teacher explains concepts clearly, checks our basic understanding, and builds step by step.\nThe teacher explains some concepts clearly but sometimes moves ahead assuming we already know the basics.\nThe teacher moves too quickly to advanced topics, making concepts hard to understand.",
        "Summary": "no"
    },
    {
        "Theme": "Curiosity",
        "Baseline Questions": "Does the teacher use real-world examples, analogies, or diagrams to make concepts stick?",
        "Question Type": "single-choice",
        "Options": "The teacher regularly uses real life examples and visuals that make concepts memorable.\nThe teacher sometimes uses real life examples .\nThe teacher rarely uses real-life examples and mostly teaches concepts strictly as per the module.",
        "Summary": "no"
    },
    {
        "Theme": "Class Structure",
        "Baseline Questions": "Is the teaching pace appropriate to actually learn, while still covering the syllabus?",
        "Question Type": "single-choice",
        "Options": "The pace is right - fast enough to cover syllabus, slow enough to understand.\nThe pace is sometimes too fast or too slow.\nThe pace makes it hard to follow - too rushed, or too slow and disengaging.",
        "Summary": "no"
    },
    {
        "Theme": "Communication",
        "Baseline Questions": "Is the teacher’s voice clear, understandable, and easy to hear throughout the class?",
        "Question Type": "single-choice",
        "Options": "The teacher’s voice is always clearly audible and easy to understand throughout the class.\nThe teacher’s voice is sometimes difficult to hear and understand.\nIt is often difficult to hear and understand what the teacher is saying.",
        "Summary": "no"
    },
    {
        "Theme": "Communication",
        "Baseline Questions": "Is the teacher's board work (or screen / handwriting) clear and well-organized?",
        "Question Type": "single-choice",
        "Options": "The board work is clear, legible, and organized so notes are useful later.\nThe board work is sometimes messy or hard to read.\nThe board work is often hard to read or follow.",
        "Summary": "no"
    },
    {
        "Theme": "Communication",
        "Baseline Questions": "Does the teacher encourage participation and check whether students have understood the class?",
        "Question Type": "single-choice",
        "Options": "The teacher regularly asks questions, encourages participation, and checks our understanding before moving ahead.\nThe teacher sometimes encourages participation and checks understanding.\nThe class is mostly one-way, and the teacher rarely checks whether students have understood.",
        "Summary": "no"
    },
    {
        "Theme": "Inclusive and Equitable Classroom",
        "Baseline Questions": "Does the teacher help you stay motivated and give useful exam/career guidance?",
        "Question Type": "single-choice",
        "Options": "The teacher gives useful exam strategy and encouragement that pushes me to work harder.\nThe teacher sometimes shares exam guidance and motivation.\nThe teacher rarely motivates students, and they have limited clarity about their goals.",
        "Summary": "no"
    },
    {
        "Theme": "Inclusive and Equitable Classroom",
        "Baseline Questions": "Does the teacher treat all students fairly - regardless of gender, background, or how strong they currently are in the subject?",
        "Question Type": "single-choice",
        "Options": "The teacher treats everyone equally and pays attention to weaker students too.\nThe teacher slightly favors some students (top performers, one gender, certain groups).\nThe teacher clearly favors certain students or ignores others.",
        "Summary": "no"
    },
    {
        "Theme": "Inclusive and Equitable Classroom",
        "Baseline Questions": "Does the teacher treat students with respect?",
        "Question Type": "single-choice",
        "Options": "The teacher is always respectful, even when students make mistakes.\nThe teacher is generally respectful but occasionally makes critical remarks.\nThe teacher demeans students and consistently uses fear-based methods to control the class.",
        "Summary": "no"
    },
    {
        "Theme": "Learning Outcome",
        "Baseline Questions": "How much do you feel you are actually learning from this teacher for JEE/NEET?",
        "Question Type": "single-choice",
        "Options": "I am learning a lot and feel more confident about this subject.\nI am learning some, but less than I had hoped.\nI do not feel I am learning enough; a different approach would help more.",
        "Summary": "no"
    },
    {
        "Theme": "Open Feedback",
        "Baseline Questions": "What did you like most about the class or teacher?",
        "Question Type": "subjective",
        "Options": "",
        "Summary": "yes"
    },
    {
        "Theme": "Open Feedback",
        "Baseline Questions": "What can be improved about the class or teacher?",
        "Question Type": "subjective",
        "Options": "",
        "Summary": "yes"
    }
]
