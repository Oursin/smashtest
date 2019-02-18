const StepBlock = require('./stepblock.js');
const Step = require('./step.js');

const SPACES_PER_INDENT = 4;

/**
 * Represents the test tree
 */
class Tree {
    constructor() {
        this.root = new Step();
    }

    /**
     * @param {String} line - A single line
     * @param {String} filename - The filename of the file where the line is
     * @param {Integer} lineNumber - The line number
     * @return {Integer} The number of indents in line (where each SPACES_PER_INDENT spaces counts as 1 indent). Always returns 0 for empty string or all whitespace.
     * @throws {Error} If there are an invalid number of spaces, or invalid whitespace chars, at the beginning of the step
     */
    numIndents(line, filename, lineNumber) {
        if(line.match(/^\s*$/)) { //empty string or all whitespace
            return 0;
        }

        var spacesAtFront = line.match(/^( *)([^ ]|$)/);
        var whitespaceAtFront = line.match(/^(\s*)([^\s]|$)/);

        if(spacesAtFront[1] != whitespaceAtFront[1]) {
            this.error("Spaces are the only type of whitespace allowed at the beginning of a step", filename, lineNumber);
        }
        else {
            var numSpaces = spacesAtFront[1].length;
            var numIndents = numSpaces / SPACES_PER_INDENT;

            if(numIndents - Math.floor(numIndents) != 0) {
                this.error("The number of spaces at the beginning of a step must be a multiple of " + SPACES_PER_INDENT + ". You have " + numSpaces + " space(s).", filename, lineNumber);
            }
            else {
                return numIndents;
            }
        }
    }

    /**
     * Parses in a line and converts it to a Step object
     * @param {String} line - The full text of the line
     * @param {String} filename - The filename of the file where the step is
     * @param {Integer} lineNumber - The line number of the step
     * @return {Step} The Step object representing this parsed step. The Step's text will be set to '' if this is an empty line, and to '..' if the whole line is just '..'
     * @throws {Error} If there is a parse error
     */
    parseLine(line, filename, lineNumber) {
        var step = new Step();
        step.line = line;
        step.filename = filename;
        step.lineNumber = lineNumber;

        if(line.trim() == '') {
            step.text = '';
            return step;
        }

        if(line.trim() == '..') {
            step.text = '..';
            return step;
        }

        // Matches any well-formed non-empty line
        // Explanation: Optional *, then alternating text or "string literal" or 'string literal' (non-greedy), then identifiers, then { and code, or // and a comment
        const LINE_REGEX = /^\s*(\*\s+)?(('([^\\']|(\\\\)*\\.)*'|"([^\\"]|(\\\\)*\\.)*"|.*?)+?)((\s+(\-T|\-M|\-|\~|\~\~|\+|\.\.|\#))*)(\s+(\{[^\}]*$))?(\s*(\/\/.*))?\s*$/;
        // Matches "string" or 'string', handles escaped \ and "
        const STRING_LITERAL_REGEX_WHOLE = /^('([^\\']|(\\\\)*\\.)*'|"([^\\"]|(\\\\)*\\.)*")$/;
        const STRING_LITERAL_REGEX = /'([^\\']|(\\\\)*\\.)*'|"([^\\"]|(\\\\)*\\.)*"/g;
        // Matches {var1} = Val1, {var2} = Val2, {{var3}} = Val3, etc. (minimum one {var}=Val)
        const VARS_SET_REGEX = /^(\s*((\{[^\{\}\\]+\})|(\{\{[^\{\}\\]+\}\}))\s*\=\s*(('([^\\']|(\\\\)*\\.)*'|"([^\\"]|(\\\\)*\\.)*"|.*?)+?)\s*)(\,\s*((\{[^\{\}\\]+\})|(\{\{[^\{\}\\]+\}\}))\s*\=\s*(('([^\\']|(\\\\)*\\.)*'|"([^\\"]|(\\\\)*\\.)*"|.*?)+?)\s*)*$/;
        // Matches {var} or {{var}}
        const VAR_REGEX = /\{[^\{\}\\]+\}|\{\{[^\{\}\\]+\}\}/g;

        var matches = line.match(LINE_REGEX);
        if(!matches) {
            this.error("This step is not written correctly", filename, lineNumber); // NOTE: probably unreachable (LINE_REGEX can match anything)
        }

        // Parsed parts of the line
        step.text = matches[2];
        step.identifiers = matches[8] ? matches[8].trim().split(/\s+/) : undefined;
        step.codeBlock = matches[12] ? matches[12].substring(1) : undefined; // substring() strips off leading {
        step.comment = matches[14];

        // *Function Declarations
        step.isFunctionDeclaration = (matches[1] ? matches[1].trim() == '*' : undefined);
        if(step.isFunctionDeclaration && step.text.match(STRING_LITERAL_REGEX)) {
            this.error("A *Function declaration cannot have \"strings\" inside of it", filename, lineNumber);
        }

        // Must Test
        const MUST_TEST_REGEX = /^\s*Must Test\s+(.*?)\s*$/;
        matches = step.text.match(MUST_TEST_REGEX);
        if(matches) {
            if(step.isFunctionDeclaration) {
                this.error("A *Function cannot start with Must Test", filename, lineNumber);
            }

            step.isMustTest = true;
            step.mustTestText = matches[1];
        }

        // Identifier booleans
        if(step.identifiers) {
            step.isToDo = step.identifiers.includes('-T') ? true : undefined;
            step.isManual = step.identifiers.includes('-M') ? true : undefined;
            step.isTextualStep = step.identifiers.includes('-') ? true : undefined;
            step.isDebug = step.identifiers.includes('~') ? true : undefined;
            step.isStepByStepDebug = step.identifiers.includes('~~') ? true : undefined;
            step.isNonParallel = step.identifiers.includes('+') ? true : undefined;
            step.isSequential = step.identifiers.includes('..') ? true : undefined;
            step.isExpectedFail = step.identifiers.includes('#') ? true : undefined;
        }

        if(!step.isTextualStep && !step.isFunctionDeclaration) {
            step.isFunctionCall = true;
        }

        if(typeof step.codeBlock != 'undefined' && step.isTextualStep) {
            this.error("A textual step (-) cannot have a code block a well", filename, lineNumber);
        }
        if(step.isFunctionDeclaration && step.isTextualStep) {
            this.error("A *Function declaration cannot be a textual step (-) as well", filename, lineNumber);
        }

        // Parse {var1} = Val1, {var2} = Val2, {{var3}} = Val3, etc. from text into step.varsBeingSet
        if(step.text.match(VARS_SET_REGEX)) {
            if(step.isFunctionDeclaration) {
                this.error("A step setting {variables} cannot start with a *", filename, lineNumber);
            }

            var textCopy = step.text + "";
            step.varsBeingSet = [];
            while(textCopy.trim() != "") {
                matches = textCopy.match(VARS_SET_REGEX);
                if(!matches) {
                    this.error("A part of this line doesn't properly set a variable", filename, lineNumber); // NOTE: probably unreachable
                }

                if(matches[2].match(/"|'/g)) {
                    this.error("You cannot have quotes inside a {variable} that you're setting", filename, lineNumber);
                }

                step.varsBeingSet.push({
                    name: matches[2].replace(/\{|\}/g, ''),
                    value: matches[5],
                    isLocal: matches[2].includes('{{')
                });

                textCopy = textCopy.replace(matches[1], ''); // strip the leading {var}=Step from the string
                textCopy = textCopy.replace(/^\,/, ''); // string the leading comma, if there is one
            }

            // If there are multiple vars being set, each value must be a string literal
            if(step.varsBeingSet.length > 1) {
                for(var i = 0; i < step.varsBeingSet.length; i++) {
                    if(!step.varsBeingSet[i].value.match(STRING_LITERAL_REGEX_WHOLE)) {
                        this.error("When multiple {variables} are being set on a single line, those {variables} can only be set to 'string constants'", filename, lineNumber);
                    }
                }
            }
        }

        // Create a list of vars contained in this step (including those within quotes)
        matches = step.text.match(VAR_REGEX);
        if(matches) {
            step.varsList = [];
            for(var i = 0; i < matches.length; i++) {
                var match = matches[i];
                var name = match.replace(/\{|\}/g, '');
                var isLocal = match.startsWith('{{');

                if(step.isFunctionDeclaration && !isLocal) {
                    this.error("All variables in a *Function declaration must be {{local}}. {" + name + "} is not.", filename, lineNumber);
                }

                var elementFinder = this.parseElementFinder(name);
                if(elementFinder) {
                    step.varsList.push({
                        name: name,
                        isLocal: isLocal,
                        elementFinder: elementFinder
                    });
                }
                else {
                    step.varsList.push({
                        name: name,
                        isLocal: isLocal
                    });
                }
            }
        }

        // If {vars} contain quotes, they must be valid ElementFinders ({vars} to the left of an = have already been vetted for the absence of quotes)
        matches = step.text.match(VAR_REGEX);
        if(matches) {
            for(var i = 0; i < matches.length; i++) {
                var name = matches[i].replace(/\{|\}/g, '');
                if(name.match(/"|'/g) && !this.parseElementFinder(name)) {
                    this.error("{variable} names containing quotes must be valid ElementFinders", filename, lineNumber);
                }
            }
        }

        return step;
    }

    /**
     * Parses text inside brackets into an ElementFinder
     * @param {String} text - The text to parse, without the brackets ({})
     * @return {Object} An object containing ElementFinder components (text, selector, nextTo - any one of which can be undefined), or null if this is not a valid ElementFinder
     */
    parseElementFinder(name) {
        const ELEMENTFINDER_TEXT = `('[^']+?'|"[^"]+?")`;
        const ELEMENTFINDER_SELECTOR = `([^"']+?)`;
        const ELEMENTFINDER_NEXTTO = `(next\\s+to\\s+('[^']+?'|"[^"]+?"))`;

        var matches = null;
        if(matches = name.match(`^\\s*(` + ELEMENTFINDER_TEXT + `)\\s*$`)) {
            return {text: matches[2].slice(1,-1)};
        }
        else if(matches = name.match(`^\\s*(` + ELEMENTFINDER_TEXT + `\\s+` + ELEMENTFINDER_SELECTOR + `)\\s*$`)) {
            return {text: matches[2].slice(1,-1), selector: matches[3]};
        }
        else if(matches = name.match(`^\\s*(` + ELEMENTFINDER_TEXT + `\\s+` + ELEMENTFINDER_SELECTOR + `\\s+` + ELEMENTFINDER_NEXTTO + `)\\s*$`)) {
            return {text: matches[2].slice(1,-1), selector: matches[3], nextTo: matches[5].slice(1,-1)};
        }
        else if(matches = name.match(`^\\s*(` + ELEMENTFINDER_TEXT + `\\s+` + ELEMENTFINDER_NEXTTO + `)\\s*$`)) {
            return {text: matches[2].slice(1,-1), nextTo: matches[4].slice(1,-1)};
        }
        else if(matches = name.match(`^\\s*(` + ELEMENTFINDER_SELECTOR + `\\s+` + ELEMENTFINDER_NEXTTO + `)\\s*$`)) {
            return {selector: matches[2], nextTo: matches[4].slice(1,-1)};
        }
        else {
            return null;
        }
    }

    /**
     * Parses a string and adds it onto root
     * @param {String} buffer - Contents of a test file
     * @param {String} filename - Name of the test file
     */
    parseIn(buffer, filename) {
        var lines = buffer.split(/[\r\n|\r|\n]/);

        // Convert each string in lines to either a Step object
        // For a line that's part of a code block, insert the code into the Step representing the code block and remove that line
        var lastStepCreated = null;
        var currentlyInsideCodeBlockFromLineNum = -1; // if we're currently inside a code block, that code block started on this line, otherwise -1
        for(var i = 0; i < lines.length;) {
            var line = lines[i];

            if(currentlyInsideCodeBlockFromLineNum != -1) { // we're currently inside a code block
                if(line.match(new RegExp("[ ]{" + (lastStepCreated.indents * SPACES_PER_INDENT) + ",}\}\s*(\/\/.*?)?\s*"))) { // code block is ending
                    lastStepCreated.codeBlock += "\n";
                    currentlyInsideCodeBlockFromLineNum = -1;
                }
                else {
                    lastStepCreated.codeBlock += ("\n" + line);
                }

                lines.splice(i, 1); // remove Step at index i
                // do not advance i as we've just removed from lines and i is where it needs to be
            }
            else {
                var step = this.parseLine(line, filename, i + 1);
                step.indents = this.numIndents(line, filename, i + 1);

                if(!lastStepCreated && step.indents != 0) {
                    this.error("The first step must have 0 indents", filename, i + 1);
                }

                // If this is the start of a new code block
                if(typeof step.codeBlock != 'undefined') {
                    currentlyInsideCodeBlockFromLineNum = i + 1;
                }

                lines[i] = step;
                lastStepCreated = lines[i];

                i++;
            }
        }

        // If we're still inside a code block, and EOF was reached, complain that a code block is not closed
        if(currentlyInsideCodeBlockFromLineNum != -1) {
            this.error("An unclosed code block was found", filename, currentlyInsideCodeBlockFromLineNum);
        }

        // Look for groups of consecutive steps that consititute a step block, and replace them with a StepBlock object
        // A step block 1) is preceded by a '' step, '..' step, or start of file, 2) is followed by a '' line, or end of file,
        // 3) has no '' steps in the middle, and 4) all steps are at the same indent level
        for(var i = 0; i < lines.length;) {
            if(i == 0 || lines[i].text == '' || lines[i].text == '..') {
                // Current step may start a step block. See how far down it goes.

                var potentialStepBlock = new StepBlock();
                potentialStepBlock.indents = 0;

                if(lines[i].text != '') {
                    potentialStepBlock.indents = lines[i].indents;
                    potentialStepBlock.steps.push(lines[i]);
                }

                if(lines[i].text == '..') {
                    potentialStepBlock.isSequential = true;
                }

                for(var j = i + 1; j < lines.length; j++) {
                    if(lines[j].text == '') {
                        break; // we've reached the end of the step block
                    }
                    else if(lines[j].indents != lines[i].indents) {
                        // StepBlock is ruined, due to consecutive steps being at different indents
                        potentialStepBlock = null;
                        break;
                    }
                    else { // lines[j] is a non-empty step at the same indent level as the previous step
                        if(lines[j].text == '..') {
                            this.error("You cannot have a .. line at the same indent level as the line above", filename, i + 1);
                        }
                        else {
                            // We're all good
                            potentialStepBlock.steps.push(lines[i]);
                        }
                    }
                }

                if(potentialStepBlock && potentialStepBlock.steps.length > 1) {
                    // We've found a valid step block
                    // Have the StepBlock object we created replace its corresponding Steps
                    lines.splice(i, potentialStepBlock.steps.length, potentialStepBlock);
                }

                i = j;
            }
            else {
                i++;
            }
        }

        // Remove steps that are '' or '..' (we don't need them anymore)
        for(var i = 0; i < lines.length;) {
            if(lines[i].text == '' || lines[i].text == '..') {
                lines.splice(i, 1);
            }
            else {
                i++;
            }
        }

        // Set the parents and children of each Step/StepBlock in lines, based on the indents of each Step/StepBlock
        // Insert the contents of lines into the tree (under this.root)
        for(var i = 0; i < lines.length; i++) {
            var currStepObj = lines[i]; // either a Step or StepBlock object
            var prevStepObj = i > 0 ? lines[i-1] : null;

            // Indents of new step vs. last step
            var indentsAdvanced = 0;
            if(prevStepObj != null) {
                indentsAdvanced = currStepObj.indents - prevStepObj.indents;
            }

            if(indentsAdvanced == 0) { // current step is a peer of the previous step
                if(prevStepObj) {
                    currStepObj.parent = prevStepObj.parent;
                }
                else { // only the root has been inserted thus far
                    currStepObj.parent = this.root;
                }

                currStepObj.parent.children.push(currStepObj);
            }
            else if(indentsAdvanced == 1) { // current step is a child of the previous step
                currStepObj.parent = prevStepObj;
                prevStepObj.children.push(currStepObj);
            }
            else if(indentsAdvanced > 1) {
                this.error("You cannot have a step that has 2 or more indents beyond the previous step", filename, i + 1);
            }
            else if(indentsAdvanced < 0) { // current step is a child of a descendant of the previous step
                var parent = prevStepObj.parent;
                for(var i = indentsAdvanced; i < 0; i++) {
                    if(parent.parent == null) {
                        this.error("Invalid number of indents", filename, i + 1); // NOTE: probably unreachable
                    }

                    parent = parent.parent;
                }

                currStepObj.parent = parent;
                parent.children.push(currStepObj);
            }
        }
    }

    /**
     * Throws an Error with the given message, filename, and line number
     * @throws {Error}
     */
    error(msg, filename, lineNumber) {
        throw new Error(msg + " " + this.filenameAndLine(filename, lineNumber));
    }

    /**
     * @return {String} String representing the given filename a line number, appropriate for logging or console output
     */
    filenameAndLine(filename, lineNumber) {
        return "[" + filename + ":" + lineNumber + "]";
    }
}
module.exports = Tree;
