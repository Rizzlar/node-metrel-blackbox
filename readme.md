#Metrel Blackbox

This is a Node.js implementation of the Blackbox protocol available on Metrel test instruments.

https://www.metrel.si/support/confluence/mpd/en/applications-and-tips/black-box-protocol

## WARNING!
This is a work in progress, use at your own risk. The protocol is not yet fully implemented and has not been properly tested. Each instrument seems to have slightly different behaviour, so this may not work fully with your instrument.

## ⚠️ Safety Warning ⚠️
I would assume that if you are here, you know what you are doing. However, it is possible to bypass safety features of the instrument when using the blackbox protocol. It is your responsibility to ensure the safety of the operator, instrument and the installation/equipment under test. The following safety warnings are copied directly from the Metrel documentation. Ensure you read the latest documentation for any updates to the below.
- Consider all generally known precautions in order to avoid risk of electric shock. Hazardous tests, using Black Box protocol, can start automatically and it is programmer’s responsibility to implement necessary safety measures.
Read Instruction manual of test instrument carefull
y, otherwise use of the instrument may be 
dangerous for the operator, for the instrument or f
or the equipment under test! 
- Consider warning markings on the instrument! 
- If the test equipment is used in manner not specified in the Instruction manual the protection provided by the equipment may be impaired! 
- Do not use the instrument and accessories if any damage is noticed! 
- Some measurements require safety touch pre-test to check for the presence of dangerous voltage  on  PE  test  terminal.  Disabling  or  ignoring this  option  by  using  Black  Box  protocol without additional safety measures can lead to hazardous situation. 

## Installation
``` bash
 npm install metrel-blackbox
 ```

## Example Usage
``` javascript
const blackbox = require('metrel-blackbox');
blackbox.connect('COM4'),then((status) => {
  if (status.enabled) doTest();
  else blackbox.enable().then(() => doTest());
}, (err) => {
  console.log("Could not connect to instrument", err);
});


function doTest(){
  blackbox.singleTest('014').then((result) => {
    console.log("Test complete", result);
  }, (err) => {
    console.log("Test could not be completed", err);
  });
}

blackbox.events.on('inspection', (inspection) => {
  console.log("Inspection Required", inspection);
});

blackbox.events.on('userInteraction', (interaction) => {
  console.log("User Interaction Required", interaction);
});

blackbox.events.on('userInteractionEnd', (interaction) => {
  console.log("User Interaction Completed", interaction);
});

blackbox.events.on('stepEndDecision', () => {
  console.log("Step Ended - Decision Required");
});

blackbox.events.on('pause', () => {
  console.log("Autotest Paused");
});
```
## To Do
- Implement all command responses
- Documentation
- Tests
