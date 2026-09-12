// Explicit identities observed in Everfit; never infer a coach from a first name.
const OWNERS: Record<string, string> = {
  "shaun lundall": "Shiraad",
  "mark smith": "Farrukh",
  "stephanie hughes": "Stef",
  "belkys barrios": "Belkys",
  "waleed ahmed": "Waleed",
  "ahmad saeed": "Ahmad",
  "martin iliev": "Martin",
  "kevin khalid": "Kevin",
  "fatima naz": "Fatima",
};
export function everfitCoach(owner: string): string | null {
  return OWNERS[owner.trim().toLowerCase()] ?? null;
}
