export type V2Client={id:string;name:string;days_remaining:number|null;replies_7d:number|null;activity_7d:number|null;workouts_completed:number|null;workouts_assigned:number|null;workout_pct:number|null;summary:string;evidence:string[]};
export type V2Report={schema_version:2;coach_name:string;review_date:string;timezone:"Asia/Karachi";retention_days:number;roster_count:number;roster_complete:boolean;coverage_notes:string[];summary:string;clients:V2Client[]};
const DAY=86400000;
export function dateShift(date:string,days:number){return new Date(Date.parse(date)+days*DAY).toISOString().slice(0,10);}
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))throw Error("Expected a report object.");return v as Record<string,unknown>;}
function text(v:unknown,max=2000){if(typeof v!=="string"||v.length>max)throw Error("Invalid report text.");return v.trim();}
function integer(v:unknown,nullable=false):number|null{if(nullable&&v===null)return null;if(typeof v!=="number"||!Number.isSafeInteger(v)||v<0)throw Error("Counts must be nonnegative integers or null when unknown.");return v;}
function notes(v:unknown){if(!Array.isArray(v)||v.length>50)throw Error("Invalid evidence or coverage notes.");return v.map(n=>text(n));}
export function parseReport(value:unknown):V2Report{
 const r=object(value);if(r.schema_version!==2)throw Error("Use the Everfit V2 report format (schema_version: 2).");
 const coach_name=text(r.coach_name,100),review_date=text(r.review_date,10);
 if(!coach_name||!/^\d{4}-\d{2}-\d{2}$/.test(review_date)||!Number.isFinite(Date.parse(review_date))||new Date(review_date).toISOString().slice(0,10)!==review_date)throw Error("A coach and valid review date are required.");
 if(r.timezone!=="Asia/Karachi")throw Error("Report timezone must be Asia/Karachi.");
 const retention_days=integer(r.retention_days)!;if(retention_days<1||retention_days>90)throw Error("Retention window must be 1–90 days.");
 const roster_count=integer(r.roster_count)!;if(typeof r.roster_complete!=="boolean"||!Array.isArray(r.clients)||r.clients.length>2000)throw Error("Invalid roster coverage.");
 const clients=r.clients.map(v=>{const c=object(v);const id=text(c.id,200),name=text(c.name,200);if(!id||!name)throw Error("Each client needs a stable source ID and name.");
 const days=c.days_remaining;if(days!==null&&(typeof days!=="number"||!Number.isSafeInteger(days)||Math.abs(days)>36500))throw Error("Invalid days remaining.");
 const completed=integer(c.workouts_completed,true),assigned=integer(c.workouts_assigned,true);
 if((completed===null)!==(assigned===null)||completed!==null&&assigned!==null&&completed>assigned)throw Error("Workout counts must be supplied together and completed cannot exceed assigned.");
 const pct=c.workout_pct;if(pct!==null&&(typeof pct!=="number"||!Number.isFinite(pct)||pct<0||pct>100))throw Error("Workout percentage must be 0–100 or null.");
 return {id,name,days_remaining:days as number|null,replies_7d:integer(c.replies_7d,true),activity_7d:integer(c.activity_7d,true),workouts_completed:completed,workouts_assigned:assigned,workout_pct:pct as number|null,summary:text(c.summary),evidence:notes(c.evidence)};});
 if(new Set(clients.map(c=>c.id)).size!==clients.length)throw Error("Duplicate client IDs.");
 if(roster_count<clients.length||r.roster_complete&&roster_count!==clients.length)throw Error("Roster count does not match the client rows.");
 return {schema_version:2,coach_name,review_date,timezone:"Asia/Karachi",retention_days,roster_count,roster_complete:r.roster_complete,coverage_notes:notes(r.coverage_notes),summary:text(r.summary,12000),clients};
}
export function isGhost(c:V2Client){return c.days_remaining!==null&&c.days_remaining>0&&c.replies_7d===0&&c.activity_7d===0;}
export function programStatus(days:number|null){return days===null?"Unknown":days>0?"Active":days===0?"Ends today":days>=-7?"Ended within 7 days":"Ended";}
export function metrics(r:V2Report){
 const active=r.clients.filter(c=>c.days_remaining!==null&&c.days_remaining>0),ghosts=active.filter(isGhost);
 const unknownGhosts=active.filter(c=>c.replies_7d===null||c.activity_7d===null);
 const countRows=active.filter(c=>c.workouts_assigned!==null);
 const completed=countRows.reduce((n,c)=>n+c.workouts_completed!,0),assigned=countRows.reduce((n,c)=>n+c.workouts_assigned!,0);
 const percentages=active.flatMap(c=>c.workouts_assigned!==null?(c.workouts_assigned>0?[100*c.workouts_completed!/c.workouts_assigned]:[]):c.workout_pct!==null?[c.workout_pct]:[]);
 const allCounts=countRows.length===active.length;
 return {active,ghosts,unknownGhosts,ghostPct:active.length?100*ghosts.length/active.length:null,retentions:r.clients.filter(c=>c.days_remaining!==null&&c.days_remaining>=-7&&c.days_remaining<=r.retention_days),ended:r.clients.filter(c=>c.days_remaining!==null&&c.days_remaining< -7),unknownDates:r.clients.filter(c=>c.days_remaining===null),workoutPct:allCounts?(assigned?100*completed/assigned:null):(percentages.length?percentages.reduce((a,b)=>a+b,0)/percentages.length:null),workoutMethod:allCounts?"Workouts completed / assigned":"Mean client completion (available data)",completed,assigned,workoutCoverage:allCounts?countRows.length:percentages.length};
}
