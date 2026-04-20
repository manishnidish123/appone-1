import apponeSdk from './src/utils/appOneSdk.js'
import fs from 'fs'

var args = process.argv.slice(2);
if(!args[0]){
  process.exit(1)
}
console.log('fetching ' + args[0])
const data = await apponeSdk.getApplicationFile(args[0])
fs.writeFile('./logs/output-' + args[0] + '.json' , JSON.stringify(data, null, 4), err => {
  if (err) {
    console.error(err);
  }
  // file written successfully
  process.exit(0)
});
