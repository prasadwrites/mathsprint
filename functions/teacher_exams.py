"""Math teacher certification exams: which exams each state uses, and each exam's content categories and weights from
its official framework. Decks for an exam are built by the admin (generate_deck with certExam) and listed on the
/teacher-exams page for the teacher's state. The questions are original: Claude writes new ones to the framework's
categories, never copies released test items.

Checked against the official frameworks on 2026-11-27 (the `source` of each exam). Where a state isn't listed, the page
says we haven't confirmed its exam yet."""

from __future__ import annotations

import math

# Each category: (name, approximate share of the exam in percent, what it covers). Shares are of the scored
# multiple-choice part when the exam also has written responses (MTEL, NYSTCE, CSET); we practice multiple choice only.
EXAMS: dict[str, dict] = {
    "praxis-5165": {
        "program": "Praxis", "name": "Mathematics", "code": "5165", "grades": "Grades 7–12",
        "questions": 66, "minutes": 180,
        "format": "66 selected-response and numeric-entry questions, 180 minutes, on-screen graphing calculator",
        "teaching": "About 25% of questions apply the content to a Task of Teaching Mathematics.",
        "source": "https://praxis.ets.org/test/5165.html",
        "categories": [
            ("Number and Quantity", 10, "real and complex number systems, rational exponents, vectors and matrices, units and quantities, number theory"),
            ("Algebra", 20, "expressions, polynomials and rational expressions, equations and inequalities, systems, structure and seeing equivalent forms"),
            ("Functions", 20, "function notation and key features, linear, quadratic, polynomial, exponential, logarithmic, trigonometric and periodic functions, transformations, inverses and composition, modeling"),
            ("Calculus", 10, "limits and continuity, derivatives and their applications, integrals and the fundamental theorem, sequences and series"),
            ("Geometry", 20, "lines, angles and polygons, congruence, similarity and proofs, transformations, circles, right-triangle trigonometry and the laws of sines and cosines, coordinate geometry, area, surface area and volume"),
            ("Statistics and Probability", 20, "data displays, center and spread, normal distributions, linear models and correlation, sampling and inference, probability rules, conditional probability, expected value, counting"),
        ],
    },
    "praxis-5164": {
        "program": "Praxis", "name": "Middle School Mathematics", "code": "5164", "grades": "Grades 5–9",
        "questions": 66, "minutes": 180,
        "format": "66 selected-response and numeric-entry questions, 180 minutes, on-screen graphing calculator",
        "teaching": "About 30% of questions apply the content to a Task of Teaching Mathematics.",
        "source": "https://praxis.ets.org/test/5164.html",
        "categories": [
            ("Numbers and Operations", 23, "place value, operations with fractions, decimals and integers, ratios, rates and proportional reasoning, percent, number theory, exponents and scientific notation, irrational numbers"),
            ("Algebra", 23, "expressions and equivalence, linear equations and inequalities, systems, quadratic equations, patterns"),
            ("Functions", 17, "function concepts and notation, linear functions, slope and rate of change, comparing representations, nonlinear functions, modeling"),
            ("Geometry and Measurement", 20, "angles, triangles and polygons, the Pythagorean theorem, transformations, congruence and similarity, circles, area, surface area and volume, unit conversions"),
            ("Statistics and Probability", 17, "data displays, mean, median, spread, sampling, scatter plots and lines of fit, probability of simple and compound events"),
        ],
    },
    "texes-235": {
        "program": "TExES", "name": "Mathematics 7–12", "code": "235", "grades": "Grades 7–12",
        "questions": 100, "minutes": 300,
        "format": "100 selected-response questions, 5 hours",
        "teaching": "Domains V and VI cover mathematical processes, learning, instruction and assessment.",
        "source": "https://tx.nesinc.com/Content/StudyGuide/TX_SG_obj_235.htm",
        "categories": [
            ("Number Concepts", 14, "real and complex number systems, number theory, operations and algorithms, proportional reasoning"),
            ("Patterns and Algebra", 33, "patterns, functions and their representations, linear, quadratic, polynomial, rational, radical, exponential, logarithmic and trigonometric functions, systems, matrices, limits, derivatives and integrals"),
            ("Geometry and Measurement", 19, "measurement, Euclidean geometry and proof, transformations, coordinate geometry, two- and three-dimensional figures"),
            ("Probability and Statistics", 14, "data analysis, probability, random variables and distributions, sampling and inference"),
            ("Mathematical Processes and Perspectives", 10, "reasoning and proof, problem solving, connections, communication, history of mathematics"),
            ("Mathematical Learning, Instruction and Assessment", 10, "how students learn mathematics, typical student errors, planning instruction, formative and summative assessment"),
        ],
    },
    "texes-115": {
        "program": "TExES", "name": "Mathematics 4–8", "code": "115", "grades": "Grades 4–8",
        "questions": 100, "minutes": 300,
        "format": "100 selected-response questions, 5 hours",
        "teaching": "Domains V and VI cover mathematical processes, learning, instruction and assessment.",
        "source": "https://www.tx.nesinc.com/Content/StudyGuide/TX_SG_obj_115.htm",
        "categories": [
            ("Number Concepts", 16, "place value, the real number system, operations with fractions, decimals and integers, number theory, proportional reasoning"),
            ("Patterns and Algebra", 21, "patterns, linear and simple nonlinear functions, equations and inequalities, rate of change, representations"),
            ("Geometry and Measurement", 21, "measurement and conversions, angles, polygons and circles, the Pythagorean theorem, transformations, area, surface area and volume"),
            ("Probability and Statistics", 16, "data displays, measures of center and spread, sampling, probability of simple and compound events"),
            ("Mathematical Processes and Perspectives", 10, "reasoning, problem solving, connections, communication, history of mathematics"),
            ("Mathematical Learning, Instruction and Assessment", 16, "how students learn mathematics, typical student errors, planning instruction, assessment"),
        ],
    },
    "cset-211": {
        "program": "CSET", "name": "Mathematics Subtest I", "code": "211", "grades": "Grades 7–12 and Foundational-Level",
        "questions": 35, "minutes": None,
        "format": "35 multiple-choice and 3 constructed-response questions, 2 hours 30 minutes (we practice the multiple choice)",
        "teaching": "",
        "source": "https://ctcexams.nesinc.com/Content/StudyGuide/CA_SG_obj_211.htm",
        "categories": [
            ("Number and Quantity", 29, "real and complex numbers, number theory, divisibility and primes, quantities and units, vectors and matrices"),
            ("Algebra", 71, "algebraic structures, polynomials and their roots, equations and inequalities, functions and their graphs, linear algebra"),
        ],
    },
    "cset-212": {
        "program": "CSET", "name": "Mathematics Subtest II", "code": "212", "grades": "Grades 7–12 and Foundational-Level",
        "questions": 35, "minutes": None,
        "format": "35 multiple-choice and 3 constructed-response questions, 2 hours 30 minutes (we practice the multiple choice)",
        "teaching": "",
        "source": "https://www.ctcexams.nesinc.com/Content/StudyGuide/CA_SG_obj_212.htm",
        "categories": [
            ("Geometry", 71, "Euclidean geometry and proof, congruence and similarity, circles, coordinate and transformational geometry, three-dimensional figures, trigonometry"),
            ("Probability and Statistics", 29, "probability, counting, random variables and distributions, data analysis, inference"),
        ],
    },
    "cset-213": {
        "program": "CSET", "name": "Mathematics Subtest III", "code": "213", "grades": "Grades 7–12",
        "questions": 30, "minutes": None,
        "format": "30 multiple-choice and 2 constructed-response questions, 2 hours (we practice the multiple choice)",
        "teaching": "",
        "source": "https://ctcexams.nesinc.com/Content/StudyGuide/CA_SG_obj_211.htm",
        "categories": [
            ("Calculus", 100, "limits and continuity, derivatives and their applications, integrals and the fundamental theorem, sequences and series"),
        ],
    },
    "ftce-026": {
        "program": "FTCE", "name": "Mathematics 6–12", "code": "026", "grades": "Grades 6–12",
        "questions": 50, "minutes": 150,
        "format": "About 50 multiple-choice questions, 2 hours 30 minutes",
        "teaching": "",
        "source": "https://fl.nesinc.com/studyguide/FL_SG_obj_026_redev.htm",
        "categories": [
            ("Number sense, operations and proportionality", 8, "rational numbers, order of operations with exponents and radicals, irrational numbers, scientific notation, ratios, proportions and percent"),
            ("Algebra", 19, "equivalent expressions, key features of relationships, function types, linear equations and inequalities, absolute value and quadratic inequalities, systems"),
            ("Geometry and trigonometry", 28, "angles, triangles and polygons, proofs, congruence and similarity, circles, transformations, coordinate geometry, area and volume, right-triangle trigonometry, laws of sines and cosines, vectors"),
            ("Data analysis, statistics and probability", 19, "data displays, center and spread, normal distributions, regression and correlation, sampling, probability, expected value"),
            ("Precalculus and calculus", 16, "polynomial, rational, exponential, logarithmic and trigonometric functions, sequences and series, limits, derivatives, integrals"),
            ("Student reasoning and instructional practice", 10, "student errors and misconceptions, instructional strategies, assessment data"),
        ],
    },
    "ftce-025": {
        "program": "FTCE", "name": "Middle Grades Mathematics 5–9", "code": "025", "grades": "Grades 5–9",
        "questions": 50, "minutes": 150,
        "format": "About 50 multiple-choice questions, 2 hours 30 minutes",
        "teaching": "",
        "source": "https://fl.nesinc.com/studyguide/FL_SG_obj_025_redev.htm",
        "categories": [
            ("Number sense, operations and proportionality", 15, "rational numbers, order of operations with integer exponents and absolute value, irrational numbers, scientific notation, ratios, proportions and percent"),
            ("Algebra", 30, "expressions, linear equations and inequalities, slope and intercepts, systems, functions, quadratic relationships"),
            ("Geometry", 20, "angles and lines, triangles and polygons, the Pythagorean theorem, transformations, circles, area, surface area and volume"),
            ("Data analysis, statistics and probability", 15, "data displays, center and spread, scatter plots, sampling, probability"),
            ("Student reasoning and instructional practice", 20, "student errors and misconceptions, instructional strategies, analyzing assessment data"),
        ],
    },
    "nystce-004": {
        "program": "NYSTCE", "name": "Mathematics CST", "code": "004", "grades": "Grades 7–12",
        "questions": 90, "minutes": None,
        "format": "90 selected-response questions and 1 constructed-response question (we practice the selected response)",
        "teaching": "The constructed response (20% of the score) covers pedagogical content knowledge.",
        "source": "https://www.nystce.nesinc.com/Content/Docs/NY_fld04_objs.pdf",
        "categories": [
            ("Number and Quantity", 10, "real and complex numbers, rational exponents, quantities and units, vectors and matrices"),
            ("Algebra", 25, "expressions and polynomials, equations and inequalities, systems, rational and radical equations"),
            ("Functions", 21, "function families, transformations, inverses and composition, exponential, logarithmic and trigonometric functions, modeling"),
            ("Calculus", 12, "limits, derivatives and their applications, integrals"),
            ("Geometry and Measurement", 19, "congruence, similarity and proofs, transformations, circles, trigonometry, coordinate geometry, area and volume"),
            ("Statistics and Probability", 13, "data analysis, normal distributions, regression, inference, probability and counting"),
        ],
    },
    "mtel-63": {
        "program": "MTEL", "name": "Mathematics", "code": "63", "grades": "Grades 8–12",
        "questions": 85, "minutes": None,
        "format": "85 multiple-choice questions and 2 open-response items (we practice the multiple choice)",
        "teaching": "",
        "source": "https://www.mtel.nesinc.com/Content/StudyGuide/MA_SG_obj_63.htm",
        "categories": [
            ("Number Sense and Operations", 12, "the real number system, rational exponents, complex numbers, number theory"),
            ("Relations, Functions and Algebra", 38, "expressions, equations and inequalities, function families, polynomial, rational, exponential, logarithmic and trigonometric functions, modeling, linear algebra"),
            ("Geometry and Measurement", 25, "Euclidean geometry and proof, transformations, coordinate geometry, trigonometry and vectors, measurement"),
            ("Probability, Statistics, Calculus and Discrete Mathematics", 25, "statistics and probability, limits, derivatives and integrals, sequences and series, counting and discrete structures"),
        ],
    },
    "mtel-65": {
        "program": "MTEL", "name": "Middle School Mathematics", "code": "65", "grades": "Grades 5–8",
        "questions": 85, "minutes": None,
        "format": "85 multiple-choice questions and 2 open-response items (we practice the multiple choice)",
        "teaching": "",
        "source": "https://www.mtel.nesinc.com/Content/StudyGuide/MA_SG_obj_65.htm",
        "categories": [
            ("Number System and Quantity", 25, "place value, the real number system, operations with rational numbers, ratios and proportional reasoning, number theory"),
            ("Algebra, Functions and Modeling", 37, "expressions, equations and inequalities, linear and nonlinear functions, modeling"),
            ("Geometry and Measurement", 25, "angles and figures, transformations, congruence and similarity, the Pythagorean theorem, area, surface area and volume"),
            ("Statistics and Probability", 13, "data displays, center and spread, sampling, probability"),
        ],
    },
    "ilts-208": {
        "program": "ILTS", "name": "Mathematics", "code": "208", "grades": "Grades 9–12",
        "questions": 100, "minutes": 195,
        "format": "100 multiple-choice questions, 3 hours 15 minutes",
        "teaching": "",
        "source": "https://il.nesinc.com/Content/STUDYGUIDE/IL_SG_OBJ_208.htm",
        "categories": [
            ("Mathematical Practices, Technology and Disciplinary Literacy", 17, "problem-solving strategies, reasoning and proof, modeling, technology, mathematical communication"),
            ("Number Systems and Operations", 11, "real and complex numbers, number theory, operations"),
            ("Functions and Algebra", 33, "expressions, equations and inequalities, function families, transformations, systems, matrices"),
            ("Differential and Integral Calculus", 11, "limits, derivatives and their applications, integrals"),
            ("Measurement and Geometry", 17, "Euclidean and coordinate geometry, transformations, trigonometry, measurement"),
            ("Statistics, Probability and Discrete Mathematics", 11, "data analysis, probability, counting, sequences and discrete structures"),
        ],
    },
    "ilts-202": {
        "program": "ILTS", "name": "Middle Grades (5–8) Mathematics", "code": "202", "grades": "Grades 5–8",
        "questions": 100, "minutes": 195,
        "format": "100 multiple-choice questions, 3 hours 15 minutes",
        "teaching": "",
        "source": "https://www.il.nesinc.com/Content/STUDYGUIDE/IL_SG_obj_202.htm",
        "categories": [
            ("Core Content", 14, "polynomial, radical and rational expressions, representations of functions, introductory calculus ideas"),
            ("Fractions, Ratios and the Number System", 20, "fractions and decimals, ratios, rates and percent, the real number system, number theory"),
            ("Relations, Functions and Algebra", 24, "expressions, linear equations and inequalities, systems, linear and nonlinear functions"),
            ("Measurement and Geometry", 14, "angles and figures, transformations, the Pythagorean theorem, area, surface area and volume"),
            ("Probability and Statistics", 14, "data displays, center and spread, sampling, probability"),
            ("Disciplinary Literacy in Mathematics", 14, "mathematical vocabulary and notation, reading and writing mathematical arguments, communicating reasoning"),
        ],
    },
    "mttc-131": {
        "program": "MTTC", "name": "Mathematics (7–12)", "code": "131", "grades": "Grades 7–12",
        "questions": 100, "minutes": 150,
        "format": "100 multiple-choice questions, 2 hours 30 minutes",
        "teaching": "Most of this exam is about teaching mathematics; 38% is mathematical content.",
        "source": "https://www.mttc.nesinc.com/Content/STUDYGUIDE/MI_SG_obj_131.htm",
        "categories": [
            ("Pedagogical Knowledge and Practices for Teaching Mathematics", 18, "equitable teaching, rich tasks, questioning and discourse, using representations and tools"),
            ("Students as Learners of Mathematics", 13, "how students develop understanding, common errors and misconceptions, building on prior knowledge"),
            ("Social Contexts of Mathematics Teaching and Learning", 13, "classroom community, students' backgrounds and identities, families and communities"),
            ("Mathematical Content", 38, "number, algebra and functions, geometry and measurement, statistics and probability, calculus"),
            ("Mathematics Practices, Dispositions and Curriculum", 18, "mathematical practices such as reasoning and modeling, curriculum and standards, assessment"),
        ],
    },
    "mttc-133": {
        "program": "MTTC", "name": "Mathematics (5–9)", "code": "133", "grades": "Grades 5–9",
        "questions": 100, "minutes": 150,
        "format": "100 multiple-choice questions, 2 hours 30 minutes",
        "teaching": "Most of this exam is about teaching mathematics; 38% is mathematical content.",
        "source": "https://www.mttc.nesinc.com/Content/STUDYGUIDE/MI_SG_obj_133.htm",
        "categories": [
            ("Pedagogical Knowledge and Practices for Teaching Mathematics", 18, "equitable teaching, rich tasks, questioning and discourse, using representations and tools"),
            ("Students as Learners of Mathematics", 13, "how students develop understanding, common errors and misconceptions, building on prior knowledge"),
            ("Social Contexts of Mathematics Teaching and Learning", 13, "classroom community, students' backgrounds and identities, families and communities"),
            ("Mathematical Content", 38, "number and proportional reasoning, expressions and equations, functions, geometry and measurement, statistics and probability"),
            ("Mathematics Practices, Dispositions and Curriculum", 18, "mathematical practices such as reasoning and modeling, curriculum and standards, assessment"),
        ],
    },
    "gace-022": {
        "program": "GACE", "name": "Mathematics Test I", "code": "022", "grades": "Grades 6–12",
        "questions": None, "minutes": 135,
        "format": "Selected-response and constructed-response questions, 2 hours 15 minutes (we practice the selected response)",
        "teaching": "",
        "source": "https://gace.ets.org/prepare/materials/522",
        "categories": [
            ("Number and Quantity", 30, "real and complex numbers, quantities and units, vectors and matrices, number theory"),
            ("Algebra", 40, "expressions and polynomials, equations and inequalities, systems, rational and radical equations"),
            ("Discrete Mathematics and Calculus", 30, "counting, sequences and recursion, graphs and algorithms, limits, derivatives and integrals"),
        ],
    },
    "gace-013": {
        "program": "GACE", "name": "Middle Grades Mathematics", "code": "013", "grades": "Grades 4–8",
        "questions": None, "minutes": None,
        "format": "Selected-response questions (check the GACE site for timing)",
        "teaching": "",
        "source": "https://gace.ets.org/prepare/materials/013",
        "categories": [
            ("Arithmetic and Algebra", 65, "number and operations, ratios and proportional reasoning, expressions, equations and inequalities, functions"),
            ("Geometry and Data", 35, "geometry and measurement, transformations, statistics and probability"),
        ],
    },
    "nes-304": {
        "program": "NES", "name": "Mathematics", "code": "304", "grades": "Grades 6–12",
        "questions": None, "minutes": None,
        "format": "Multiple-choice questions (check the NES site for timing)",
        "teaching": "",
        "source": "https://www.aepa.nesinc.com/Content/Docs/NES_Framework_304.pdf",
        "categories": [
            ("Mathematical Processes and Number Sense", 19, "problem solving, mathematical reasoning and communication, number theory"),
            ("Patterns, Algebra and Functions", 24, "relations and functions, linear, quadratic and polynomial functions, exponential and logarithmic functions, rational and radical functions"),
            ("Measurement and Geometry", 19, "measurement, Euclidean geometry in two and three dimensions, coordinate and transformational geometry"),
            ("Trigonometry and Calculus", 19, "trigonometric functions, differential calculus, integral calculus"),
            ("Statistics, Probability and Discrete Mathematics", 19, "statistics, probability, discrete mathematics"),
        ],
    },
    "oae-027": {
        "program": "OAE", "name": "Mathematics", "code": "027", "grades": "Grades 7–12",
        "questions": 150, "minutes": 255,
        "format": "150 multiple-choice questions, 4 hours 15 minutes",
        "teaching": "",
        "source": "https://www.oh.nesinc.com/CONTENT/STUDYGUIDE/OH_SG_OBJ_027.htm",
        "categories": [
            ("Mathematical Processes and Number Sense", 19, "problem solving, reasoning and communication, ratios, proportions and rates, number theory"),
            ("Patterns, Algebra and Functions", 24, "relations and functions, polynomial, exponential, logarithmic, rational and radical functions"),
            ("Measurement and Geometry", 19, "measurement, Euclidean geometry, coordinate and transformational geometry"),
            ("Trigonometry and Calculus", 19, "trigonometric functions, differential calculus, integral calculus"),
            ("Statistics, Probability and Discrete Mathematics", 19, "statistics, probability, discrete mathematics"),
        ],
    },
    "oae-030": {
        "program": "OAE", "name": "Middle Grades Mathematics", "code": "030", "grades": "Grades 4–9",
        "questions": 125, "minutes": 255,
        "format": "125 multiple-choice questions, 4 hours 15 minutes",
        "teaching": "",
        "source": "https://www.oh.nesinc.com/CONTENT/STUDYGUIDE/OH_SG_OBJ_030.htm",
        "categories": [
            ("Number Sense and Operations", 19, "subsets of the real numbers, place value, estimation, number theory, operations with integers, fractions and decimals"),
            ("Algebra and Functions", 36, "patterns, expressions, linear equations and inequalities, systems, linear and nonlinear functions"),
            ("Measurement and Geometry", 27, "measurement and conversions, angles and polygons, the Pythagorean theorem, transformations, area, surface area and volume"),
            ("Statistics and Probability", 18, "data displays, center and spread, sampling, probability"),
        ],
    },
    "moca-012": {
        "program": "MoCA", "name": "Middle School Education: Mathematics", "code": "012", "grades": "Grades 5–9",
        "questions": 80, "minutes": 150,
        "format": "80 multiple-choice questions, 2 hours 30 minutes",
        "teaching": "",
        "source": "https://mo.nesinc.com/Content/STUDYGUIDE/MO_SG_obj_012.htm",
        "categories": [
            ("Number and Operations", 19, "subsets of the real numbers, place value, estimation, number theory, operations with integers, fractions and decimals"),
            ("Algebra and Functions", 36, "patterns, expressions, linear equations and inequalities, systems, linear and nonlinear functions"),
            ("Measurement and Geometry", 27, "measurement and conversions, angles and polygons, the Pythagorean theorem, transformations, area, surface area and volume"),
            ("Statistics and Probability", 18, "data displays, center and spread, sampling, probability"),
        ],
    },
}

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky",
    "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota",
    "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island",
    "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}

PRAXIS = ["praxis-5165", "praxis-5164"]
_PRAXIS_STATES = "AL AK AR CO CT DE HI ID IN KS KY LA ME MD MS MT NE NV NH NJ NM NC ND OK PA RI SC SD TN UT VT VA WV WI WY"

# State -> (exam ids, a note shown with them). States not here: we haven't confirmed their exams yet.
STATES: dict[str, tuple[list[str], str]] = {
    **{s: (PRAXIS, "") for s in _PRAXIS_STATES.split()},
    "TN": (PRAXIS, "Tennessee also accepts NES Mathematics (304) in place of Praxis 5165."),
    "MO": (["praxis-5165", "moca-012"], ""),
    "TX": (["texes-235", "texes-115"], ""),
    "CA": (["cset-211", "cset-212", "cset-213"], "Foundational-Level Mathematics needs Subtests I and II; the full Mathematics credential needs all three."),
    "FL": (["ftce-026", "ftce-025"], ""),
    "NY": (["nystce-004"], ""),
    "MA": (["mtel-63", "mtel-65"], ""),
    "IL": (["ilts-208", "ilts-202"], ""),
    "MI": (["mttc-131", "mttc-133"], ""),
    "GA": (["gace-022", "gace-013"], "GACE Mathematics (522) is two tests. We cover Test I (022) so far, not Test II (023)."),
    "AZ": (["nes-304"], "Arizona's middle grades math exam isn't covered yet."),
    "OH": (["oae-027", "oae-030"], ""),
}


def exam_label(exam_id: str) -> str:
    e = EXAMS[exam_id]
    return f"{e['program']} {e['name']} ({e['code']})"


def is_exam(value: object) -> bool:
    return isinstance(value, str) and value in EXAMS


def minutes_per_question(exam_id: str) -> float | None:
    e = EXAMS.get(exam_id) or {}
    return round(e["minutes"] / e["questions"], 2) if e.get("minutes") and e.get("questions") else None


def catalog() -> dict:
    """What the /teacher-exams page shows: every exam and which ones each state uses."""
    exams = [{
        "id": i,
        "label": exam_label(i),
        **{k: e[k] for k in ("program", "name", "code", "grades", "format", "teaching", "source")},
        "minutesPerQuestion": minutes_per_question(i),
        "categories": [{"name": n, "percent": p, "covers": c} for n, p, c in e["categories"]],
    } for i, e in EXAMS.items()]
    states = [{"code": c, "name": n, "exams": STATES[c][0] if c in STATES else [], "note": STATES[c][1] if c in STATES else ""}
              for c, n in sorted(STATE_NAMES.items(), key=lambda kv: kv[1])]
    return {"exams": exams, "states": states}


def split(weights: list[int], total: int) -> list[int]:
    """`total` questions shared out by weight, largest remainder first, so they always add up to `total`."""
    whole = sum(weights)
    raw = [w * total / whole for w in weights]
    counts = [math.floor(r) for r in raw]
    for i in sorted(range(len(raw)), key=lambda i: raw[i] - counts[i], reverse=True)[: total - sum(counts)]:
        counts[i] += 1
    return counts


def plan(exam_id: str, focus: object, count: int) -> list[tuple[str, str, int]]:
    """(category, what it covers, how many questions) for a deck: one category when `focus` names one by its index,
    otherwise every category in proportion to its weight on the exam."""
    cats = EXAMS[exam_id]["categories"]
    if isinstance(focus, int) and not isinstance(focus, bool) and 0 <= focus < len(cats):
        name, _, covers = cats[focus]
        return [(name, covers, count)]
    return [(n, c, k) for (n, _, c), k in zip(cats, split([p for _, p, _ in cats], count)) if k]


def deck_title(exam_id: str, focus: object) -> str:
    cats = EXAMS[exam_id]["categories"]
    e = EXAMS[exam_id]
    short = f"{e['program']} {e['code']}"
    if isinstance(focus, int) and not isinstance(focus, bool) and 0 <= focus < len(cats):
        return f"{short}: {cats[focus][0]}"[:80]
    return f"{short} {e['name']}: mixed practice"[:80]


def brief(exam_id: str) -> str:
    """Who the deck is for, added to the prompt."""
    e = EXAMS[exam_id]
    return (
        f"This deck is for adults preparing for the {exam_label(exam_id)} teacher certification exam ({e['grades']}). "
        "Write original questions at the level and in the style of a certification exam, testing the content a beginning "
        "math teacher must know deeply. Never copy or closely paraphrase released or published test items. "
        + (e["teaching"] + " " if e["teaching"] else "")
    )
