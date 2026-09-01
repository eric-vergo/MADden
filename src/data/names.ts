// Name pools for roster generation. Both lists are kept sorted and duplicate
// free so a generator can index them deterministically.
//
// BLOCKED_FULL_NAMES exists so the league never accidentally ships a real
// player's name. The pools are deliberately chosen so no first/last pair can
// spell one of those combinations — tests/data/names.test.ts enforces that, so
// adding "Brady" or "Rodgers" to LAST_NAMES fails the build rather than
// shipping quietly.

export const FIRST_NAMES: readonly string[] = [
  'Aaron', 'Andre', 'Antoine', 'Austin', 'Blake', 'Brandon', 'Bryce', 'Caleb',
  'Cameron', 'Carl', 'Cedric', 'Chase', 'Chris', 'Cole', 'Colin', 'Cordell',
  'Curtis', 'Damon', 'Dante', 'Darius', 'Darnell', 'DeAndre', 'Dennis', 'Derek',
  'Devin', 'Dexter', 'Dominic', 'Donte', 'Dwayne', 'Eli', 'Elijah', 'Emmett',
  'Evan', 'Ezra', 'Felix', 'Gabe', 'Garrett', 'Grant', 'Hakeem', 'Hank',
  'Hector', 'Hugo', 'Isaiah', 'Ivan', 'Jabari', 'Jamal', 'Jared', 'Jasper',
  'Javon', 'Jerome', 'Jonah', 'Jordan', 'Julius', 'Kareem', 'Keenan', 'Kelvin',
  'Kendall', 'Khalil', 'Kyle', 'Lamont', 'Landon', 'Levi', 'Lionel', 'Logan',
  'Lucas', 'Malcolm', 'Marcel', 'Mario', 'Marshall', 'Mason', 'Maurice',
  'Micah', 'Miles', 'Mitchell', 'Nate', 'Nico', 'Noah', 'Omar', 'Orlando',
  'Oscar', 'Otis', 'Paul', 'Preston', 'Quentin', 'Quincy', 'Rashad', 'Reggie',
  'Rex', 'Ricardo', 'Roman', 'Ronnie', 'Roy', 'Ruben', 'Russell', 'Santiago',
  'Saul', 'Sean', 'Silas', 'Simeon', 'Spencer', 'Sterling', 'Tariq', 'Terrence',
  'Theo', 'Tobias', 'Trent', 'Trevon', 'Tucker', 'Victor', 'Vince', 'Wade',
  'Warren', 'Xavier', 'Zane',
];

export const LAST_NAMES: readonly string[] = [
  'Abernathy', 'Alston', 'Ashworth', 'Banks', 'Barrow', 'Beaumont', 'Bellamy',
  'Bexley', 'Blackwood', 'Boone', 'Bowers', 'Brantley', 'Briggs', 'Calloway',
  'Carmichael', 'Carver', 'Cavanaugh', 'Chastain', 'Coleman', 'Colvin',
  'Crawford', 'Crenshaw', 'Cross', 'Dalton', 'Deveraux', 'Dillard', 'Donovan',
  'Draper', 'Driscoll', 'Dunbar', 'Easley', 'Eastwood', 'Ellsworth',
  'Fairbanks', 'Fallon', 'Farrow', 'Fenwick', 'Finch', 'Fontaine', 'Forsythe',
  'Foster', 'Gainey', 'Galloway', 'Garner', 'Gentry', 'Goodwin', 'Granger',
  'Greaves', 'Gresham', 'Hale', 'Halloran', 'Hargrove', 'Harmon', 'Hawthorne',
  'Hayes', 'Hendrix', 'Hollister', 'Holloway', 'Holt', 'Huxley', 'Ingram',
  'Irons', 'Jarvis', 'Jennings', 'Keating', 'Kemp', 'Kendrick', 'Kilgore',
  'Kincaid', 'Lachlan', 'Landry', 'Langston', 'Larkin', 'Latimer', 'Ledger',
  'Lockhart', 'Lowery', 'Maddox', 'Marlow', 'Mercer', 'Merritt', 'Monroe',
  'Montgomery', 'Mosley', 'Nash', 'Newsome', 'Northcutt', 'Oakes', 'Ormond',
  'Osborne', 'Pemberton', 'Pennington', 'Presley', 'Quimby', 'Radcliffe',
  'Rainey', 'Ramsey', 'Redmond', 'Renner', 'Rhodes', 'Ridley', 'Rockwell',
  'Rowan', 'Saldana', 'Satterfield', 'Sexton', 'Shepard', 'Sinclair', 'Slade',
  'Stanton', 'Steele', 'Stokes', 'Sutton', 'Talley', 'Tanner', 'Thackery',
  'Thorne', 'Tillman', 'Trask', 'Truitt', 'Vance', 'Vaughn', 'Wexley',
  'Whitaker', 'Whitfield', 'Wilder', 'Winslow', 'Woodard', 'Wren', 'Yardley',
  'York', 'Zeller',
];

/** Disambiguation suffix pool when 20 re-rolls still collide inside a league. */
export const MIDDLE_INITIALS: readonly string[] = [
  'A', 'B', 'C', 'D', 'E', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'R', 'T', 'W',
];

/** Real players the generator must never spell. Kept as exact "First Last". */
export const BLOCKED_FULL_NAMES: ReadonlySet<string> = new Set([
  'Tom Brady', 'Peyton Manning', 'Eli Manning', 'Patrick Mahomes',
  'Aaron Rodgers', 'Brett Favre', 'Joe Montana', 'Jerry Rice',
  'Barry Sanders', 'Emmitt Smith', 'Walter Payton', 'Jim Brown',
  'Lawrence Taylor', 'Reggie White', 'Deion Sanders', 'Randy Moss',
  'Terrell Owens', 'Ray Lewis', 'Brian Urlacher', 'Troy Polamalu',
  'Darrelle Revis', 'Richard Sherman', 'Julius Peppers', 'Michael Strahan',
  'Jerome Bettis', 'Marshall Faulk', 'LaDainian Tomlinson', 'Adrian Peterson',
  'Saquon Barkley', 'Alvin Kamara', 'Nick Chubb', 'Derrick Henry',
  'Travis Kelce', 'Rob Gronkowski', 'Aaron Donald', 'J.J. Watt',
  'Khalil Mack', 'Von Miller', 'Justin Jefferson', 'Davante Adams',
  'Stefon Diggs', 'Josh Allen', 'Justin Herbert', 'Joe Burrow',
  'Russell Wilson', 'Cam Newton', 'Michael Vick', 'John Elway',
  'Dan Marino', 'Johnny Unitas', 'Terry Bradshaw', 'Joe Namath',
  'Dick Butkus', 'Mike Singletary', 'Ronnie Lott', 'Bo Jackson',
]);

export function isBlockedName(firstName: string, lastName: string): boolean {
  return BLOCKED_FULL_NAMES.has(`${firstName} ${lastName}`);
}

/** Total distinct names the pools can spell — sanity bound for generators. */
export const NAME_COMBINATIONS = FIRST_NAMES.length * LAST_NAMES.length;
