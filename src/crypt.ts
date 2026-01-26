const argon2 = require('argon2');

class Crypt {
  crypt = async (msg: string) => {
    try {
      const hash = await argon2.hash(msg);

      console.log(hash);
    } catch (err) {
      console.warn("There was an error.");
    }
  }
}

export const crypt = new Crypt();
