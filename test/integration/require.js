var expect = require('expect.js');
var hoodie_server = require('../../');

describe('Requireability', function (done) {
  it('should require & start', function () {
    var config = {
      www_port: 5010,
      admin_port: 5020,
      admin_password: '12345'
    };
    hoodie_server.start(config, function() {
      // verify this function get called
      expect(true).to.be(true);
      done()
    });
  });

});
