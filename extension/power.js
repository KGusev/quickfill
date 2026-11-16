/* Deterministic value processing and portable entry templates. No expressions are evaluated. */
(function(root) {
  const transforms = ['none','trim','upper','lower','digits','format'];
  const templates = {
    person:{name:'',first_name:'',last_name:'',email:'',phone:''},
    company:{company:'',website:'',email:'',phone:''},
    address:{address:'',city:'',postal_code:'',country:''},
    testAccount:{email:'test+{{counter}}@example.com',name:'Test {{counter}}',reference:'{{uuid}}',created:'{{date}}'}
  };
  const dynamic = raw => /\{\{[^{}]+\}\}/.test(raw);
  function resolve(raw, context, transform = {type:'none'}) {
    let result = raw.replace(/\{\{([^{}]+)\}\}/g, (_,key) => {
      if (!Object.hasOwn(context,key)) throw new Error('unknownVariable');
      return String(context[key]);
    });
    switch(transform.type) {
      case 'none': break;
      case 'trim': result=result.trim();break;
      case 'upper': result=result.toLocaleUpperCase();break;
      case 'lower': result=result.toLocaleLowerCase();break;
      case 'digits': result=result.replace(/\D/g,'');break;
      case 'format': {
        const pattern=transform.format || '{value}';
        if(pattern.includes('{value}')) result=pattern.replaceAll('{value}',result);
        else {const digits=result.replace(/\D/g,'');let index=0;result=pattern.replace(/#/g,()=>digits[index++] || '');}
        break;
      }
      default: throw new Error('invalidImport');
    }
    return result;
  }
  function context(counter=1, now=new Date(), uuid=crypto.randomUUID()) {
    return {date:now.toISOString().slice(0,10),timestamp:String(now.getTime()),uuid,counter};
  }
  const api={transforms,templates,dynamic,resolve,context};root.QuickfillPower=api;
  if(typeof module!=='undefined')module.exports=api;
})(globalThis);
